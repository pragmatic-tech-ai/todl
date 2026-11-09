import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Scalar } from "../../manifest/logical.js";
import type { InstanceMirror } from "../../manifest/reflection/reflection.js";
import { CypherEngine } from "../engine.js";
import { CypherWriteStats } from "../writer.js";
import type { ICypherWriter } from "../writer.js";
import type { ICypherGraph } from "../graph.js";
import { RelDirection } from "../enums.js";
import { CypherSemanticError } from "../errors.js";
import { ListValue, MapValue } from "../values-structured.js";
import { NodeRefValue, NodeValue, NullValue } from "../values.js";

class NodeState
{
    constructor(public readonly Id: string, public readonly Concept: string, public readonly Fields: Map<string, Scalar>)
    {
    }

    public ToMirror(): InstanceMirror
    {
        const fields = this.Fields;
        return {
            node: { id: this.Id, attrs: Object.fromEntries(fields) },
            type: { fullName: this.Concept, name: this.Concept },
            field: (name: string) => (fields.has(name) ? { value: fields.get(name) } : undefined),
        } as unknown as InstanceMirror;
    }
}

class MemGraph implements ICypherGraph
{
    constructor(private readonly nodes: InstanceMirror[])
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

    public Expand(): InstanceMirror[]
    {
        return [];
    }

    public IsInstanceOf(m: InstanceMirror, label: string): boolean
    {
        return m.type.fullName === label;
    }

    public HasRelationshipType(_relType: string): boolean
    {
        return true;
    }

    public ResolveConcept(label: string): string
    {
        if (label === "Customer" || label === "shop.Customer") return "shop.Customer";
        throw new CypherSemanticError(`unknown label "${label}"`);
    }
}

class SpyGraph extends MemGraph
{
    public Calls = 0;

    constructor()
    {
        super([]);
    }

    public override NodesByLabel(label: string): InstanceMirror[]
    {
        this.Calls++;
        return super.NodesByLabel(label);
    }

    public override AllInstances(): InstanceMirror[]
    {
        this.Calls++;
        return super.AllInstances();
    }

    public override Reflect(id: string): InstanceMirror | undefined
    {
        this.Calls++;
        return super.Reflect(id);
    }

    public override ResolveConcept(label: string): string
    {
        this.Calls++;
        return super.ResolveConcept(label);
    }
}

class FakeCypherWriter implements ICypherWriter
{
    public Commits = 0;
    public Rollbacks = 0;
    public Creates = 0;
    public FailOnCreateNumber = -1;
    private counter = 0;
    private readonly state = new Map<string, NodeState>();

    constructor(seed: NodeState[] = [])
    {
        for (const s of seed) this.state.set(s.Id, s);
    }

    public CreateNode(concept: string, properties: ReadonlyMap<string, Scalar>): string
    {
        if (this.Creates === this.FailOnCreateNumber) throw new Error("boom");
        this.Creates++;
        const id = `n${this.counter++}`;
        this.state.set(id, new NodeState(id, concept, new Map(properties)));
        return id;
    }

    public SetProperty(nodeId: string, name: string, value: Scalar): void
    {
        this.state.get(nodeId)!.Fields.set(name, value);
    }

    public RemoveProperty(nodeId: string, name: string): void
    {
        this.state.get(nodeId)!.Fields.delete(name);
    }

    public CreateRelationship(): boolean
    {
        return true;
    }

    public DeleteRelationship(): boolean
    {
        return true;
    }

    public DeleteNode(nodeId: string): void
    {
        this.state.delete(nodeId);
    }

    public Begin(): void
    {
    }

    public Commit(): ICypherGraph
    {
        this.Commits++;
        return this.Snapshot();
    }

    public Rollback(): void
    {
        this.Rollbacks++;
    }

    public Stats(): CypherWriteStats
    {
        return new CypherWriteStats(this.Creates);
    }

    public Snapshot(): MemGraph
    {
        return new MemGraph([...this.state.values()].map((s) => s.ToMirror()));
    }
}

class Fixture
{
    public static Seed(): NodeState[]
    {
        return [
            new NodeState("c1", "shop.Customer", new Map<string, Scalar>([["name", "Ada"]])),
            new NodeState("c2", "shop.Customer", new Map<string, Scalar>([["name", "Bob"]])),
        ];
    }

    public static Engine(writer: FakeCypherWriter): CypherEngine
    {
        return new CypherEngine(writer.Snapshot(), undefined, writer);
    }
}

describe("cypher two-phase write execution", () =>
{
    test("a write query with no writer throws WritesRequireWriter", () =>
    {
        const graph = new SpyGraph();
        const engine = new CypherEngine(graph);
        assert.throws(() => engine.Execute("CREATE (n:shop.Customer {name: 'Ada'})"), (e: unknown) => e instanceof CypherSemanticError && /require an ICypherWriter/.test(e.message));
        assert.equal(graph.Calls, 0);
    });

    test("a failing Rollback does not mask the original error", () =>
    {
        const writer = new FakeCypherWriter();
        writer.FailOnCreateNumber = 0;
        writer.Rollback = () => { throw new Error("rollback failed"); };
        assert.throws(() => Fixture.Engine(writer).Execute("CREATE (n:shop.Customer {name: 'x'})"), /boom/);
    });

    test("CREATE ... RETURN n returns the created node re-resolved from the committed graph", () =>
    {
        const writer = new FakeCypherWriter();
        const r = Fixture.Engine(writer).Execute("CREATE (n:shop.Customer {name: 'Ada'}) RETURN n");
        assert.deepEqual(r.Columns, ["n"]);
        assert.equal(r.Rows.length, 1);
        const cell = r.Rows[0]![0]!;
        assert.ok(cell instanceof NodeValue);
        assert.ok(!(cell instanceof NodeRefValue));
        assert.equal((cell as NodeValue).Id, "n0");
        assert.equal((cell as NodeValue).Field("name"), "Ada");
    });

    test("MATCH (n) SET n.tier='gold' RETURN n.tier yields the new value", () =>
    {
        const writer = new FakeCypherWriter(Fixture.Seed());
        const r = Fixture.Engine(writer).Execute("MATCH (n:shop.Customer) SET n.tier = 'gold' RETURN n.tier");
        assert.equal(r.Rows.length, 2);
        assert.deepEqual(r.Rows.map((row) => row[0]!.ToDto()), ["gold", "gold"]);
    });

    test("RETURN of a node deleted earlier in the same query yields null", () =>
    {
        const writer = new FakeCypherWriter(Fixture.Seed());
        const r = Fixture.Engine(writer).Execute("MATCH (n:shop.Customer {name: 'Ada'}) DELETE n RETURN n");
        assert.equal(r.Rows.length, 1);
        assert.equal(r.Rows[0]![0], NullValue.Instance);
    });

    test("a write-only query (no RETURN) returns empty columns/rows and non-null Stats", () =>
    {
        const writer = new FakeCypherWriter();
        const r = Fixture.Engine(writer).Execute("CREATE (n:shop.Customer {name: 'Ada'})");
        assert.deepEqual(r.Columns, []);
        assert.deepEqual(r.Rows, []);
        assert.ok(r.Stats !== undefined);
        assert.equal(r.Stats!.NodesCreated, 1);
        assert.equal(writer.Commits, 1);
    });

    test("an error thrown during apply calls writer.Rollback and does not call Commit", () =>
    {
        const writer = new FakeCypherWriter();
        writer.FailOnCreateNumber = 1;
        assert.throws(() => Fixture.Engine(writer).Execute("UNWIND [1,2,3] AS i CREATE (n:shop.Customer {name: 'x'})"), /boom/);
        assert.equal(writer.Rollbacks, 1);
        assert.equal(writer.Commits, 0);
    });

    test("RowCap/Skip do not truncate the apply drain", () =>
    {
        const writer = new FakeCypherWriter();
        const r = Fixture.Engine(writer).Execute("UNWIND [1,2,3,4,5] AS i CREATE (n:shop.Customer {name: 'x'})", new Map(), { RowCap: 1, Skip: 1 });
        assert.equal(writer.Creates, 5);
        assert.equal(r.Truncated, false);
    });

    test("a collect/list of created nodes in the final projection is re-resolved (no throw, no rollback)", () =>
    {
        const writer = new FakeCypherWriter();
        const r = Fixture.Engine(writer).Execute("UNWIND [1,2] AS i CREATE (n:shop.Customer {name: 'x'}) WITH collect(n) AS ns RETURN ns");
        assert.equal(writer.Rollbacks, 0);
        assert.equal(writer.Commits, 1);
        const list = r.Rows[0]![0]! as ListValue;
        assert.ok(list instanceof ListValue);
        assert.equal(list.Items.length, 2);
        assert.ok(list.Items.every((i) => i instanceof NodeValue));
    });

    test("a map holding a node deleted earlier re-resolves that entry to null", () =>
    {
        const writer = new FakeCypherWriter(Fixture.Seed());
        const r = Fixture.Engine(writer).Execute("MATCH (n:shop.Customer {name: 'Ada'}) DELETE n RETURN {k: n} AS m");
        const m = r.Rows[0]![0]! as MapValue;
        assert.equal(m.Get("k"), NullValue.Instance);
    });

    test("intra-query read-your-writes is unsupported: WITH reading a property off a just-created node throws and rolls back", () =>
    {
        const writer = new FakeCypherWriter();
        assert.throws(() => Fixture.Engine(writer).Execute("CREATE (n:shop.Customer {name: 'Ada'}) WITH n.name AS v RETURN v"), (e: unknown) => e instanceof CypherSemanticError && /read-your-writes/.test(e.message));
        assert.equal(writer.Rollbacks, 1);
        assert.equal(writer.Commits, 0);
    });

    test("the final projection may read a property off a just-created node (re-resolved before projecting)", () =>
    {
        const writer = new FakeCypherWriter();
        const r = Fixture.Engine(writer).Execute("CREATE (n:shop.Customer {name: 'Ada'}) RETURN n.name");
        assert.equal(r.Rows[0]![0]!.ToDto(), "Ada");
        assert.equal(writer.Rollbacks, 0);
    });
});

describe("cypher MERGE ON CREATE / ON MATCH SET execution", () =>
{
    const query = "MERGE (n:shop.Customer {name: 'Ada'}) ON CREATE SET n.tier = 'new' ON MATCH SET n.tier = 'seen' RETURN n.tier";

    test("a MERGE that creates runs only the ON CREATE actions", () =>
    {
        const writer = new FakeCypherWriter();
        const r = Fixture.Engine(writer).Execute(query);
        assert.equal(writer.Creates, 1);
        assert.deepEqual(r.Rows.map((row) => row[0]!.ToDto()), ["new"]);
    });

    test("a MERGE that matches runs only the ON MATCH actions", () =>
    {
        const writer = new FakeCypherWriter(Fixture.Seed());
        const r = Fixture.Engine(writer).Execute(query);
        assert.equal(writer.Creates, 0);
        assert.deepEqual(r.Rows.map((row) => row[0]!.ToDto()), ["seen"]);
    });

    test("a later row merging a node this query created sees it as matched", () =>
    {
        const writer = new FakeCypherWriter();
        const r = Fixture.Engine(writer).Execute(
            "UNWIND [1, 2] AS i MERGE (n:shop.Customer {name: 'Zed'}) ON CREATE SET n.c = 'created' ON MATCH SET n.m = 'matched' RETURN n.c, n.m");
        assert.equal(writer.Creates, 1);
        assert.deepEqual(r.Rows.map((row) => row.map((v) => v.ToDto())), [["created", "matched"], ["created", "matched"]]);
    });

    test("an ON CREATE action reading a property of the just-created node fails loudly and rolls back", () =>
    {
        const writer = new FakeCypherWriter();
        assert.throws(() => Fixture.Engine(writer).Execute("MERGE (n:shop.Customer {name: 'Ada'}) ON CREATE SET n.copy = n.name"), CypherSemanticError);
        assert.equal(writer.Rollbacks, 1);
        assert.equal(writer.Commits, 0);
    });
});

describe("cypher SET n = {map} full-replace execution", () =>
{
    const seed = (): NodeState[] => [new NodeState("c1", "shop.Customer", new Map<string, Scalar>([["name", "Ada"], ["tier", "gold"]]))];

    test("listed properties are set and every other own property is removed", () =>
    {
        const writer = new FakeCypherWriter(seed());
        const r = Fixture.Engine(writer).Execute("MATCH (n:shop.Customer) SET n = {name: 'Ada2', city: 'Oslo'} RETURN n.name, n.tier, n.city");
        assert.deepEqual(r.Rows.map((row) => row.map((v) => v.ToDto())), [["Ada2", null, "Oslo"]]);
    });

    test("a null entry in the map removes that property", () =>
    {
        const writer = new FakeCypherWriter(seed());
        const r = Fixture.Engine(writer).Execute("MATCH (n:shop.Customer) SET n = {name: 'X', tier: null} RETURN n.name, n.tier");
        assert.deepEqual(r.Rows.map((row) => row.map((v) => v.ToDto())), [["X", null]]);
    });

    test("SET n = null changes nothing (like SET n += null)", () =>
    {
        const writer = new FakeCypherWriter(seed());
        const r = Fixture.Engine(writer).Execute("MATCH (n:shop.Customer) SET n = null RETURN n.name, n.tier");
        assert.deepEqual(r.Rows.map((row) => row.map((v) => v.ToDto())), [["Ada", "gold"]]);
    });

    test("a non-map value is a semantic error", () =>
    {
        const writer = new FakeCypherWriter(seed());
        assert.throws(() => Fixture.Engine(writer).Execute("MATCH (n:shop.Customer) SET n = 1"), CypherSemanticError);
        assert.equal(writer.Commits, 0);
    });

    test("full-replace on a node created in the same query fails loudly (its current properties are not readable yet)", () =>
    {
        const writer = new FakeCypherWriter();
        assert.throws(() => Fixture.Engine(writer).Execute("CREATE (n:shop.Customer {name: 'A'}) SET n = {name: 'B'}"), CypherSemanticError);
        assert.equal(writer.Rollbacks, 1);
    });
});

describe("cypher path MERGE without read-your-writes (fallback graph)", () =>
{
    test("a repeated row reuses the path this query created instead of duplicating it", () =>
    {
        const writer = new FakeCypherWriter();
        Fixture.Engine(writer).Execute("UNWIND [1, 2] AS i MERGE (a:shop.Customer {name: 'P'})-[:knows]->(b:shop.Customer {name: 'Q'})");
        assert.equal(writer.Creates, 2);
    });
});
