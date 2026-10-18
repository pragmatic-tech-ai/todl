import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Scalar } from "../../manifest/logical.js";
import type { InstanceMirror } from "../../manifest/reflection/reflection.js";
import { CypherParser } from "../parser.js";
import { LogicalPlanner } from "../planner.js";
import { CypherWriteStats } from "../writer.js";
import type { ICypherWriter } from "../writer.js";
import type { ICypherGraph } from "../graph.js";
import { RelDirection } from "../enums.js";
import { CypherSemanticError } from "../errors.js";
import { NodeRefValue, NodeValue } from "../values.js";
import type { Binding } from "../binding.js";

class MemGraph implements ICypherGraph
{
    constructor(private readonly nodes: InstanceMirror[], private readonly edges: Record<string, Record<string, string[]>> = {})
    {
    }

    public static Mirror(id: string, concept: string, fields: Record<string, Scalar>): InstanceMirror
    {
        return {
            node: { id },
            type: { fullName: concept, name: concept },
            field: (name: string) => (name in fields ? { value: fields[name] } : undefined),
        } as unknown as InstanceMirror;
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

    public Expand(nodeId: string, relType: string | undefined, _direction: RelDirection): InstanceMirror[]
    {
        const ids = this.edges[nodeId]?.[relType ?? ""] ?? [];
        return ids.map((i) => this.Reflect(i)).filter((m): m is InstanceMirror => m !== undefined);
    }

    public IsInstanceOf(m: InstanceMirror, label: string): boolean
    {
        return m.type.fullName === label;
    }

    public HasRelationshipType(): boolean
    {
        return true;
    }

    public ResolveConcept(label: string): string
    {
        const known = ["shop.Customer", "shop.Order"];
        const hit = known.find((k) => k === label || k.endsWith(`.${label}`));
        if (hit === undefined) throw new CypherSemanticError(`unknown label "${label}"`);
        return hit;
    }
}

class FakeCypherWriter implements ICypherWriter
{
    public readonly Calls: string[] = [];
    private counter = 0;

    constructor(private readonly after: ICypherGraph)
    {
    }

    public CreateNode(concept: string, properties: ReadonlyMap<string, Scalar>): string
    {
        const id = `n${this.counter++}`;
        this.Calls.push(`CreateNode(${concept},${JSON.stringify([...properties])})=${id}`);
        return id;
    }

    public SetProperty(nodeId: string, name: string, value: Scalar): void
    {
        this.Calls.push(`SetProperty(${nodeId},${name},${JSON.stringify(value)})`);
    }

    public RemoveProperty(nodeId: string, name: string): void
    {
        this.Calls.push(`RemoveProperty(${nodeId},${name})`);
    }

    public CreateRelationship(fromId: string, member: string, toId: string): boolean
    {
        this.Calls.push(`CreateRelationship(${fromId},${member},${toId})`);
        return true;
    }

    public DeleteRelationship(fromId: string, member: string, toId: string): boolean
    {
        this.Calls.push(`DeleteRelationship(${fromId},${member},${toId})`);
        return true;
    }

    public DeleteNode(nodeId: string, detach: boolean): void
    {
        this.Calls.push(`DeleteNode(${nodeId},${detach})`);
    }

    public Begin(): void
    {
    }

    public Commit(): ICypherGraph
    {
        return this.after;
    }

    public Rollback(): void
    {
    }

    public Stats(): CypherWriteStats
    {
        return new CypherWriteStats();
    }
}

class WriteFixture
{
    public static readonly Ada = MemGraph.Mirror("c1", "shop.Customer", { name: "Ada" });
    public static readonly Old = MemGraph.Mirror("o1", "shop.Order", { ref: "old" });
    public static readonly Fresh = MemGraph.Mirror("o2", "shop.Order", { ref: "new" });

    public static Graph(): MemGraph
    {
        return new MemGraph([WriteFixture.Ada, WriteFixture.Old, WriteFixture.Fresh], { c1: { orders: ["o1"] } });
    }

    public static Run(cypher: string, graph: ICypherGraph = WriteFixture.Graph()): { Calls: string[]; Rows: Binding[] }
    {
        const writer = new FakeCypherWriter(graph);
        const planner = new LogicalPlanner(graph, new Map(), undefined, undefined, false, writer);
        const plan = planner.PlanForWrite(new CypherParser(cypher).Parse());
        const rows = [...plan.Mutations.Rows()];
        return { Calls: writer.Calls, Rows: rows };
    }
}

describe("cypher write operators", () =>
{
    test("CREATE calls CreateNode with resolved concept + scalar props and binds a NodeRefValue", () =>
    {
        const r = WriteFixture.Run("CREATE (n:Customer {name: 'Bob'})");
        assert.deepEqual(r.Calls, ['CreateNode(shop.Customer,[["name","Bob"]])=n0']);
        assert.ok(r.Rows[0]!.Get("n") instanceof NodeRefValue);
        assert.equal((r.Rows[0]!.Get("n") as NodeRefValue).Id, "n0");
    });

    test("MATCH ... CREATE (a)-[:orders]->(o) calls CreateNode(o) then CreateRelationship(a.Id, 'orders', o.Id)", () =>
    {
        const r = WriteFixture.Run("MATCH (a:shop.Customer) CREATE (a)-[:orders]->(o:shop.Order {ref: 'x'})");
        assert.deepEqual(r.Calls, ['CreateNode(shop.Order,[["ref","x"]])=n0', "CreateRelationship(c1,orders,n0)"]);
    });

    test("MERGE matches an existing visible node (no CreateNode) when label+props match", () =>
    {
        const r = WriteFixture.Run("MERGE (n:shop.Customer {name: 'Ada'})");
        assert.deepEqual(r.Calls, []);
        assert.ok(r.Rows[0]!.Get("n") instanceof NodeValue);
        assert.equal((r.Rows[0]!.Get("n") as NodeValue).Id, "c1");
    });

    test("MERGE creates when no visible match", () =>
    {
        const r = WriteFixture.Run("MERGE (n:shop.Customer {name: 'Zed'})");
        assert.deepEqual(r.Calls, ['CreateNode(shop.Customer,[["name","Zed"]])=n0']);
        assert.ok(r.Rows[0]!.Get("n") instanceof NodeRefValue);
    });

    test("repeated identical MERGE rows in one clause create once", () =>
    {
        const r = WriteFixture.Run("UNWIND [1,2,3] AS i MERGE (n:shop.Customer {name: 'Zed'})");
        assert.equal(r.Calls.length, 1);
        assert.equal(r.Rows.length, 3);
        assert.deepEqual(r.Rows.map((x) => (x.Get("n") as NodeRefValue).Id), ["n0", "n0", "n0"]);
    });

    test("SET n.p = scalar calls SetProperty; SET n.p = null calls RemoveProperty; n += {a:1,b:null} calls SetProperty(a) + RemoveProperty(b)", () =>
    {
        assert.deepEqual(WriteFixture.Run("MATCH (n:shop.Customer) SET n.name = 'Eve'").Calls, ['SetProperty(c1,name,"Eve")']);
        assert.deepEqual(WriteFixture.Run("MATCH (n:shop.Customer) SET n.name = null").Calls, ["RemoveProperty(c1,name)"]);
        assert.deepEqual(WriteFixture.Run("MATCH (n:shop.Customer) SET n += {a: 1, b: null}").Calls, ["SetProperty(c1,a,1)", "RemoveProperty(c1,b)"]);
    });

    test("SET n.member = otherNode replaces the ref (DeleteRelationship existing via graph.Expand then CreateRelationship)", () =>
    {
        const r = WriteFixture.Run("MATCH (n:shop.Customer), (o:shop.Order {ref: 'new'}) SET n.orders = o");
        assert.deepEqual(r.Calls, ["DeleteRelationship(c1,orders,o1)", "CreateRelationship(c1,orders,o2)"]);
    });

    test("DELETE n calls DeleteNode(id,false); DETACH DELETE calls DeleteNode(id,true)", () =>
    {
        assert.deepEqual(WriteFixture.Run("MATCH (n:shop.Customer) DELETE n").Calls, ["DeleteNode(c1,false)"]);
        assert.deepEqual(WriteFixture.Run("MATCH (n:shop.Customer) DETACH DELETE n").Calls, ["DeleteNode(c1,true)"]);
    });

    test("REMOVE n.p calls RemoveProperty", () =>
    {
        assert.deepEqual(WriteFixture.Run("MATCH (n:shop.Customer) REMOVE n.name").Calls, ["RemoveProperty(c1,name)"]);
    });

    test("an unknown label in CREATE throws CypherSemanticError (ResolveConcept)", () =>
    {
        assert.throws(() => WriteFixture.Run("CREATE (n:Nope)"), CypherSemanticError);
    });

    test("PlanForWrite returns the final RETURN projection separately and CREATE vars are in scope", () =>
    {
        const graph = WriteFixture.Graph();
        const planner = new LogicalPlanner(graph, new Map(), undefined, undefined, false, new FakeCypherWriter(graph));
        const plan = planner.PlanForWrite(new CypherParser("CREATE (n:Customer {name: 'Bob'}) RETURN n.name AS name").Parse());
        assert.ok(plan.Projection !== undefined);
        assert.equal(plan.Projection.Items[0]!.ColumnName(), "name");
    });

    test("a write clause without a writer throws CypherSemanticError", () =>
    {
        const planner = new LogicalPlanner(WriteFixture.Graph(), new Map());
        assert.throws(() => planner.Plan(new CypherParser("CREATE (n:Customer)").Parse()), CypherSemanticError);
    });
});
