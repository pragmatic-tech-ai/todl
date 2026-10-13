import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LabelScan, Expand, Filter, Project } from "../operators.js";
import { ScalarValue, NodeValue } from "../values.js";
import { RelDirection, ComparisonOp } from "../enums.js";
import { Comparison, PropertyAccess, Literal } from "../expressions.js";
import { ReturnItem } from "../query-model.js";
import type { ICypherGraph } from "../graph.js";
import type { InstanceMirror } from "../../manifest/reflection/reflection.js";

class OperatorFixtures
{
    // A minimal InstanceMirror stand-in: operators touch only node.id, type.fullName, and field(name).value.
    public static Mirror(id: string, concept: string, fields: Record<string, string>): InstanceMirror
    {
        return {
            node: { id },
            type: { fullName: concept, name: concept },
            field: (name: string) => (name in fields ? { value: fields[name] } : undefined),
        } as unknown as InstanceMirror;
    }
}

class FakeGraph implements ICypherGraph
{
    constructor(private readonly nodes: InstanceMirror[], private readonly edges: Record<string, string[]>)
    {
    }

    public NodesByLabel(label: string): InstanceMirror[]
    {
        return this.nodes.filter((n) => n.type.fullName === label);
    }

    public AllInstances(): InstanceMirror[]
    {
        return this.nodes;
    }

    public Reflect(id: string): InstanceMirror | undefined
    {
        return this.nodes.find((n) => n.node.id === id);
    }

    public Expand(nodeId: string): InstanceMirror[]
    {
        const result: InstanceMirror[] = [];
        for (const t of this.edges[nodeId] ?? [])
        {
            const m = this.Reflect(t);
            if (m !== undefined) result.push(m);
        }
        return result;
    }

    public IsInstanceOf(m: InstanceMirror, label: string): boolean
    {
        return m.type.fullName === label;
    }

    public HasRelationshipType(): boolean
    {
        return true;
    }
}

const a = OperatorFixtures.Mirror("a", "Service", { name: "checkout" });
const b = OperatorFixtures.Mirror("b", "Service", { name: "ledger" });
const graph = new FakeGraph([a, b], { a: ["b"] });

describe("cypher operators", () =>
{
    test("LabelScan yields one binding per labelled node", () =>
    {
        const rows = [...new LabelScan(graph, "x", "Service").Rows()];
        assert.deepEqual(rows.map((r) => (r.Get("x") as NodeValue).Id).sort(), ["a", "b"]);
    });

    test("Expand extends bindings along edges", () =>
    {
        const child = new LabelScan(graph, "x", "Service");
        const rows = [...new Expand(child, graph, "x", "y", "calls", RelDirection.Outgoing, undefined).Rows()];
        const pairs = rows.map((r) => [(r.Get("x") as NodeValue).Id, (r.Get("y") as NodeValue).Id]);
        assert.deepEqual(pairs, [["a", "b"]]);
    });

    test("Filter drops rows failing the predicate", () =>
    {
        const child = new LabelScan(graph, "x", "Service");
        const pred = new Comparison(new PropertyAccess("x", "name"), ComparisonOp.Eq, new Literal("checkout"));
        const rows = [...new Filter(child, pred, new Map()).Rows()];
        assert.deepEqual(rows.map((r) => (r.Get("x") as NodeValue).Id), ["a"]);
    });

    test("Project evaluates return items into named columns", () =>
    {
        const child = new LabelScan(graph, "x", "Service");
        const items = [new ReturnItem(new PropertyAccess("x", "name"), "n")];
        const rows = [...new Project(child, items, new Map()).Rows()];
        assert.deepEqual(rows.map((r) => (r.Get("n") as ScalarValue).Value).sort(), ["checkout", "ledger"]);
    });
});
