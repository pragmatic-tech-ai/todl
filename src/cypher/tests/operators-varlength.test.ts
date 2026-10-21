import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { VarLengthExpand } from "../operators-varlength.js";
import { SingleRow } from "../operators.js";
import type { IOperator } from "../operators.js";
import { NodeValue } from "../values.js";
import { PathValue } from "../values-structured.js";
import { Binding } from "../binding.js";
import { RelDirection } from "../enums.js";
import type { ICypherGraph } from "../graph.js";
import type { InstanceMirror } from "../../manifest/reflection/reflection.js";

class VarFixtures
{
    public static readonly Concept = "Service";
    public static readonly Rel = "r";
    public static readonly From = "x";
    public static readonly To = "y";
    public static readonly PathVar = "p";

    public static Mirror(id: string): InstanceMirror
    {
        return {
            node: { id },
            type: { fullName: VarFixtures.Concept, name: VarFixtures.Concept },
            field: () => undefined
        } as unknown as InstanceMirror;
    }

    public static Seed(id: string): IOperator
    {
        return new SeedRow(id);
    }

    public static Run(graph: FakeGraph, start: string, min: number, max: number, pathVar?: string, direction: RelDirection = RelDirection.Outgoing): Binding[]
    {
        const op = new VarLengthExpand(VarFixtures.Seed(start), graph, VarFixtures.From, VarFixtures.To,
            VarFixtures.Rel, direction, min, max, undefined, pathVar);
        return [...op.Rows()];
    }

    public static Ends(rows: Binding[]): string[]
    {
        return rows.map(r => (r.Get(VarFixtures.To) as NodeValue).Id).sort();
    }
}

class SeedRow implements IOperator
{
    constructor(private readonly id: string)
    {
    }

    public *Rows(): Iterable<Binding>
    {
        yield new Binding().With(VarFixtures.From, new NodeValue(VarFixtures.Mirror(this.id)));
    }
}

class FakeGraph implements ICypherGraph
{
    constructor(private readonly edges: Record<string, string[]>)
    {
    }

    public NodesByLabel(): InstanceMirror[]
    {
        return [];
    }

    public AllInstances(): InstanceMirror[]
    {
        return [];
    }

    public Reflect(id: string): InstanceMirror | undefined
    {
        return VarFixtures.Mirror(id);
    }

    public Expand(nodeId: string): InstanceMirror[]
    {
        return (this.edges[nodeId] ?? []).map(t => VarFixtures.Mirror(t));
    }

    public IsInstanceOf(): boolean
    {
        return true;
    }

    public HasRelationshipType(): boolean
    {
        return true;
    }

    public ResolveConcept(label: string): string
    {
        return label;
    }
}

describe("VarLengthExpand", () =>
{
    const chain = new FakeGraph({ a: ["b"], b: ["c"] });

    test("*1..2 over a chain yields b and c", () =>
    {
        assert.deepEqual(VarFixtures.Ends(VarFixtures.Run(chain, "a", 1, 2)), ["b", "c"]);
    });

    test("min=2 excludes the 1-hop endpoint", () =>
    {
        assert.deepEqual(VarFixtures.Ends(VarFixtures.Run(chain, "a", 2, 2)), ["c"]);
    });

    test("max caps depth", () =>
    {
        assert.deepEqual(VarFixtures.Ends(VarFixtures.Run(chain, "a", 1, 1)), ["b"]);
    });

    test("min=0 includes the start node itself", () =>
    {
        assert.deepEqual(VarFixtures.Ends(VarFixtures.Run(chain, "a", 0, 2)), ["a", "b", "c"]);
    });

    test("cycle a->b->a terminates via relationship-isomorphism", () =>
    {
        const cyclic = new FakeGraph({ a: ["b"], b: ["a"] });
        const rows = VarFixtures.Run(cyclic, "a", 1, 1000);
        // a->b, b->a are two distinct steps; a->b may not repeat, so the walk stops: endpoints b (1 hop) and a (2 hops).
        assert.deepEqual(VarFixtures.Ends(rows), ["a", "b"]);
    });

    test("self loop terminates", () =>
    {
        const loop = new FakeGraph({ a: ["a"] });
        assert.deepEqual(VarFixtures.Ends(VarFixtures.Run(loop, "a", 1, 1000)), ["a"]);
    });

    test("undirected walk does not re-use the same physical edge back and forth", () =>
    {
        // One physical edge a-b; an undirected Expand reports it from both ends.
        const single = new FakeGraph({ a: ["b"], b: ["a"] });
        const rows = VarFixtures.Run(single, "a", 1, 1000, undefined, RelDirection.Undirected);
        assert.deepEqual(VarFixtures.Ends(rows), ["b"]);
    });

    test("incoming walk orients RelValue by the real edge direction", () =>
    {
        // Real edge b->c; walking Incoming from c reaches b.
        const incoming = new FakeGraph({ c: ["b"] });
        const rows = VarFixtures.Run(incoming, "c", 1, 1, VarFixtures.PathVar, RelDirection.Incoming);
        assert.equal(rows.length, 1);
        const rel = (rows[0].Get(VarFixtures.PathVar) as PathValue).Rels[0];
        assert.equal(rel.FromId, "b");
        assert.equal(rel.ToId, "c");
    });

    test("binds PathValue with correct length", () =>
    {
        const rows = VarFixtures.Run(chain, "a", 2, 2, VarFixtures.PathVar);
        assert.equal(rows.length, 1);
        const path = rows[0].Get(VarFixtures.PathVar) as PathValue;
        assert.ok(path instanceof PathValue);
        assert.equal(path.Length(), 2);
        assert.deepEqual(path.Nodes.map(n => n.Id), ["a", "b", "c"]);
        assert.equal(path.Rels[0].FromId, "a");
        assert.equal(path.Rels[1].ToId, "c");
    });
});
