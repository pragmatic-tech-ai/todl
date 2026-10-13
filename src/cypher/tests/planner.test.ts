import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LogicalPlanner } from "../planner.js";
import { CypherParser } from "../parser.js";
import { NodeValue, ScalarValue } from "../values.js";
import { CypherSemanticError } from "../errors.js";
import type { ICypherGraph } from "../graph.js";
import type { InstanceMirror } from "../../manifest/reflection/reflection.js";

class FakeGraph implements ICypherGraph
{
    private readonly nodes = [FakeGraph.Mirror("a", "Service", { name: "checkout" }), FakeGraph.Mirror("b", "Service", { name: "ledger" })];
    private readonly edges: Record<string, string[]> = { a: ["b"] };

    public static Mirror(id: string, concept: string, fields: Record<string, string>): InstanceMirror
    {
        return {
            node: { id },
            type: { fullName: concept, name: concept },
            field: (name: string) => (name in fields ? { value: fields[name] } : undefined),
        } as unknown as InstanceMirror;
    }

    public NodesByLabel(label: string): InstanceMirror[] { return this.nodes.filter((n) => n.type.fullName === label); }
    public AllInstances(): InstanceMirror[] { return this.nodes; }
    public Reflect(id: string): InstanceMirror | undefined { return this.nodes.find((n) => n.node.id === id); }
    public Expand(nodeId: string): InstanceMirror[] { return (this.edges[nodeId] ?? []).map((t) => this.Reflect(t)!); }
    public IsInstanceOf(m: InstanceMirror, label: string): boolean { return m.type.fullName === label; }
    public HasRelationshipType(relType: string): boolean { return relType === "calls"; }
}

class PlannerHarness
{
    public static PlanRows(text: string): Map<string, unknown>[]
    {
        const model = new CypherParser(text).Parse();
        const plan = new LogicalPlanner(new FakeGraph(), new Map()).Plan(model);
        const out: Map<string, unknown>[] = [];
        for (const binding of plan.Rows())
        {
            const row = new Map<string, unknown>();
            for (const item of model.Return.Items)
            {
                const v = binding.Get(item.ColumnName());
                row.set(item.ColumnName(), v instanceof NodeValue ? v.Id : (v as ScalarValue).Value);
            }
            out.push(row);
        }
        return out;
    }
}

describe("cypher planner", () =>
{
    test("plans a scan + expand + where + project end to end", () =>
    {
        const rows = PlannerHarness.PlanRows("MATCH (a:Service)-[:calls]->(b:Service) WHERE a.name = 'checkout' RETURN b.name AS n");
        assert.deepEqual(rows.map((r) => r.get("n")), ["ledger"]);
    });

    test("unbound RETURN variable raises CypherSemanticError", () =>
    {
        assert.throws(() => PlannerHarness.PlanRows("MATCH (a:Service) RETURN b"), CypherSemanticError);
    });

    test("multiple comma paths are rejected in SP1", () =>
    {
        assert.throws(() => PlannerHarness.PlanRows("MATCH (a:Service), (b:Service) RETURN a"), CypherSemanticError);
    });

    test("unknown relationship type raises CypherSemanticError", () =>
    {
        assert.throws(() => PlannerHarness.PlanRows("MATCH (a:Service)-[:ghost]->(b:Service) RETURN a"), CypherSemanticError);
    });
});
