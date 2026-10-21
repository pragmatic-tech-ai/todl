import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Severity } from "../../compiler-services/diagnostics/diagnostic.js";
import { check } from "../../compiler-services/api.js";
import { FakeIdGenerator } from "../../compiler-services/model/tests/fake-id-generator.js";
import { CypherEngine } from "../../cypher/engine.js";
import { CypherWriteError } from "../../cypher/errors.js";
import { NodeValue } from "../../cypher/values.js";
import { ModelDraft } from "../model-draft.js";
import { ModelDraftBaker } from "../model-draft-baker.js";
import { ModelDraftWriter } from "../model-draft-writer.js";

class Fixture
{
    public static readonly Meta = {
        uri: "shop.todl",
        text: `namespace shop {
            concept Customer { name : string?; email : string?; tier : string?; orders : Order[]; }
            concept Order { total : string?; placedBy : Customer?; }
            concept Invoice { number : string; }
        }`,
    };

    public static readonly Model = `namespace app {
        import shop;
        model M : shop {
            Customer c1 { name = "Ada"; email = "a@b.c"; }
            Customer c2 { name = "Bob"; email = "b@b.c"; }
            Order o1 { total = "10"; }
            Order o2 { total = "20"; }
        }
    }`;

    public readonly Draft: ModelDraft;
    public readonly Writer: ModelDraftWriter;

    constructor()
    {
        const base = check([Fixture.Meta]).model;
        this.Draft = ModelDraft.fromSource([base], Fixture.Model, { namespace: "app" });
        this.Writer = new ModelDraftWriter(this.Draft, new FakeIdGenerator(), (d) => ModelDraftBaker.Bake(d));
    }

    // The engine's read graph is fixed at construction, so each statement gets an engine over a fresh bake
    // (a host re-binds after every write the same way).
    public get Engine(): CypherEngine
    {
        return new CypherEngine(ModelDraftBaker.Bake(this.Draft), undefined, this.Writer);
    }

    public Count(label: string): number
    {
        return this.Engine.Execute(`MATCH (n:${label}) RETURN n`).Rows.length;
    }
}

describe("ModelDraftWriter end-to-end", () =>
{
    test("CREATE ... RETURN n persists an instance and returns it with the field", () =>
    {
        const f = new Fixture();
        const r = f.Engine.Execute("CREATE (n:shop.Customer {name:'Eve'}) RETURN n");
        assert.equal(r.Rows.length, 1);
        const node = r.Rows[0]![0] as NodeValue;
        assert.equal(node.Field("name"), "Eve");
        assert.equal(f.Draft.entity(node.Id)!.field("name"), "Eve");
        assert.equal(f.Engine.Execute("MATCH (n:shop.Customer) RETURN n").Rows.length, 3);
    });

    test("MATCH ... CREATE (c)-[:orders]->(o) adds the ref", () =>
    {
        const f = new Fixture();
        const r = f.Engine.Execute("MATCH (c:shop.Customer {name:'Ada'}) CREATE (c)-[:orders]->(o:shop.Order {total:'5'}) RETURN o");
        assert.equal(r.Rows.length, 1);
        const oid = (r.Rows[0]![0] as NodeValue).Id;
        assert.deepEqual(f.Draft.entity("app.c1")!.refs("orders").map((e) => e.id), [oid]);
        assert.equal(r.Stats!.RelationshipsCreated, 1);
    });

    test("MERGE creates once; a second identical Execute does not duplicate", () =>
    {
        const f = new Fixture();
        const first = f.Engine.Execute("MERGE (c:shop.Customer {email:'new@b.c'}) RETURN c");
        assert.equal(first.Stats!.NodesCreated, 1);
        const again = f.Engine.Execute("MERGE (c:shop.Customer {email:'new@b.c'}) RETURN c");
        assert.equal(again.Stats!.NodesCreated, 0);
        assert.equal(f.Engine.Execute("MATCH (n:shop.Customer) RETURN n").Rows.length, 3);
    });

    test("SET n.tier then REMOVE n.tier round-trips (RemoveField)", () =>
    {
        const f = new Fixture();
        f.Engine.Execute("MATCH (n:shop.Customer {name:'Ada'}) SET n.tier = 'gold'");
        assert.equal(f.Draft.entity("app.c1")!.field("tier"), "gold");
        f.Engine.Execute("MATCH (n:shop.Customer {name:'Ada'}) REMOVE n.tier");
        assert.equal(f.Draft.entity("app.c1")!.field("tier"), undefined);
    });

    test("DETACH DELETE removes the node and its incident edges", () =>
    {
        const f = new Fixture();
        f.Engine.Execute("MATCH (c:shop.Customer {name:'Ada'}), (o:shop.Order {total:'10'}) CREATE (c)-[:orders]->(o)");
        assert.equal(f.Draft.IncidentEdgeCount("app.o1"), 1);
        const r = f.Engine.Execute("MATCH (o:shop.Order {total:'10'}) DETACH DELETE o");
        assert.equal(r.Stats!.NodesDeleted, 1);
        assert.equal(f.Draft.has("app.o1"), false);
        assert.deepEqual(f.Draft.entity("app.c1")!.refs("orders"), []);
        assert.equal(f.Draft.IncidentEdgeCount("app.c1"), 0);
    });

    test("DELETE of a node that still has edges without DETACH throws and rolls back", () =>
    {
        const f = new Fixture();
        f.Engine.Execute("MATCH (c:shop.Customer {name:'Ada'}), (o:shop.Order {total:'10'}) CREATE (c)-[:orders]->(o)");
        const before = structuredClone(f.Draft.toJSON());
        assert.throws(() => f.Engine.Execute("MATCH (o:shop.Order {total:'10'}) DELETE o"), CypherWriteError);
        assert.deepEqual(f.Draft.toJSON(), before);
    });

    test("writing a base/prelude node throws CypherWriteError and Rollback leaves the draft unchanged", () =>
    {
        const f = new Fixture();
        const before = structuredClone(f.Draft.toJSON());
        f.Writer.Begin();
        assert.throws(() => f.Writer.SetProperty("shop.Customer", "name", "x"), CypherWriteError);
        assert.throws(() => f.Writer.DeleteNode("shop.Customer", true), CypherWriteError);
        assert.throws(() => f.Writer.RemoveProperty("shop.Customer", "name"), CypherWriteError);
        assert.throws(() => f.Writer.CreateRelationship("shop.Customer", "orders", "app.o1"), CypherWriteError);
        assert.throws(() => f.Writer.DeleteRelationship("shop.Customer", "orders", "app.o1"), CypherWriteError);
        f.Writer.Rollback();
        assert.deepEqual(f.Draft.toJSON(), before);
    });

    test("a failing write mid-query rolls the whole query back", () =>
    {
        const f = new Fixture();
        f.Engine.Execute("MATCH (c:shop.Customer {name:'Ada'}), (o:shop.Order {total:'10'}) CREATE (c)-[:orders]->(o)");
        const before = structuredClone(f.Draft.toJSON());
        assert.throws(
            () => f.Engine.Execute("MATCH (o:shop.Order {total:'10'}) CREATE (n:shop.Customer {name:'tmp'}) DELETE o"),
            CypherWriteError,
        );
        assert.deepEqual(f.Draft.toJSON(), before);
    });

    test("CREATE with an unknown concept throws and nothing is persisted", () =>
    {
        const f = new Fixture();
        const before = structuredClone(f.Draft.toJSON());
        assert.throws(() => f.Engine.Execute("CREATE (n:shop.Nope {name:'x'}) RETURN n"), /unknown label/);
        assert.deepEqual(f.Draft.toJSON(), before);
        f.Writer.Begin();
        assert.throws(() => f.Writer.CreateNode("shop.Nope", new Map()), /unknown concept/);
        f.Writer.Rollback();
        assert.deepEqual(f.Draft.toJSON(), before);
    });

    test("CREATE (a)-[:unknownMember]->(b) throws CypherWriteError (strict resolve-or-fail)", () =>
    {
        const f = new Fixture();
        const before = structuredClone(f.Draft.toJSON());
        assert.throws(
            () => f.Engine.Execute("MATCH (c:shop.Customer {name:'Ada'}), (o:shop.Order {total:'10'}) CREATE (c)-[:bogus]->(o)"),
            CypherWriteError,
        );
        assert.deepEqual(f.Draft.toJSON(), before);
        f.Writer.Begin();
        assert.throws(() => f.Writer.CreateRelationship("app.c1", "orders", "app.c2"), CypherWriteError);
        f.Writer.Rollback();
        assert.deepEqual(f.Draft.toJSON(), before);
    });

    test("a write that introduces a genuine new model error is rejected at Commit and fully reverted", () =>
    {
        const f = new Fixture();
        const before = structuredClone(f.Draft.toJSON());
        assert.throws(() => f.Engine.Execute("CREATE (i:shop.Invoice) RETURN i"), CypherWriteError);
        assert.deepEqual(f.Draft.toJSON(), before);
        assert.equal(f.Engine.Execute("MATCH (i:shop.Invoice) RETURN i").Rows.length, 0);
        // A second identical violation on top of a pre-existing identical error is still caught (multiset baseline).
        f.Draft.create("shop.Invoice", "app.bad");
        const dirty = structuredClone(f.Draft.toJSON());
        assert.throws(() => f.Engine.Execute("CREATE (i:shop.Invoice) RETURN i"), CypherWriteError);
        assert.deepEqual(f.Draft.toJSON(), dirty);
        f.Engine.Execute("CREATE (n:shop.Customer {name:'ok'}) RETURN n");
    });

    test("Stats count accurately; a MERGE that only matched reports zero changes", () =>
    {
        const f = new Fixture();
        const created = f.Engine.Execute("CREATE (n:shop.Customer {name:'Eve', tier:'x'}) RETURN n");
        assert.equal(created.Stats!.NodesCreated, 1);
        assert.equal(created.Stats!.PropertiesSet, 2);
        const matched = f.Engine.Execute("MERGE (c:shop.Customer {email:'a@b.c'}) RETURN c");
        assert.deepEqual(matched.Stats!.ToDto(), { NodesCreated: 0, NodesDeleted: 0, RelationshipsCreated: 0, RelationshipsDeleted: 0, PropertiesSet: 0 });
        const noop = f.Engine.Execute("MATCH (c:shop.Customer {name:'Ada'}) SET c.name = 'Ada'");
        assert.equal(noop.Stats!.PropertiesSet, 0);
        const del = f.Engine.Execute("MATCH (c:shop.Customer {name:'Bob'}) DETACH DELETE c");
        assert.equal(del.Stats!.NodesDeleted, 1);
    });

    test("multi-row SET of one reference member ends with a single correct edge", () =>
    {
        const f = new Fixture();
        f.Engine.Execute("MATCH (o:shop.Order {total:'10'}), (c:shop.Customer) SET o.placedBy = c");
        assert.equal(f.Draft.entity("app.o1")!.refs("placedBy").length, 1);
        assert.deepEqual(f.Draft.diagnostics.filter((d) => d.severity === Severity.Error), []);
        f.Engine.Execute("MATCH (o:shop.Order {total:'10'}), (c:shop.Customer {name:'Ada'}) SET o.placedBy = c");
        assert.deepEqual(f.Draft.entity("app.o1")!.refs("placedBy").map((e) => e.id), ["app.c1"]);
        f.Engine.Execute("MATCH (o:shop.Order {total:'10'}), (c:shop.Customer {name:'Bob'}) SET o.placedBy = c");
        assert.deepEqual(f.Draft.entity("app.o1")!.refs("placedBy").map((e) => e.id), ["app.c2"]);
    });
});
