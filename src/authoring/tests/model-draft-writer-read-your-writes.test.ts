import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../compiler-services/api.js";
import { FakeIdGenerator } from "../../compiler-services/model/tests/fake-id-generator.js";
import { CypherEngine } from "../../cypher/engine.js";
import type { CypherValue } from "../../cypher/values.js";
import { ModelDraft } from "../model-draft.js";
import { ModelDraftBaker } from "../model-draft-baker.js";
import { ModelDraftWriter } from "../model-draft-writer.js";

class ReadYourWritesFixture
{
    private static readonly Meta = {
        uri: "shop.todl",
        text: `namespace shop {
            concept Customer { name : string?; email : string?; tier : string?; orders : Order[]; }
            concept Order { total : string?; placedBy : Customer?; }
        }`,
    };

    private static readonly Model = `namespace app {
        import shop;
        model M : shop {
            Customer c1 { name = "Ada"; email = "a@b.c"; }
            Customer c2 { name = "Bob"; email = "b@b.c"; }
            Order o1 { total = "10"; }
        }
    }`;

    public readonly Draft: ModelDraft;
    public readonly Writer: ModelDraftWriter;

    constructor()
    {
        const base = check([ReadYourWritesFixture.Meta]).model;
        this.Draft = ModelDraft.fromSource([base], ReadYourWritesFixture.Model, { namespace: "app" });
        this.Writer = new ModelDraftWriter(this.Draft, new FakeIdGenerator(), (d) => ModelDraftBaker.Bake(d));
    }

    public Run(cypher: string): unknown[][]
    {
        const engine = new CypherEngine(ModelDraftBaker.Bake(this.Draft), undefined, this.Writer);
        return engine.Execute(cypher).Rows.map((row) => row.map((v: CypherValue) => v.ToDto()));
    }

    public Count(label: string): number
    {
        return this.Run(`MATCH (n:${label}) RETURN count(n) AS c`)[0]![0] as number;
    }
}

describe("Cypher writes: intra-query read-your-writes (overlay)", () =>
{
    test("a MATCH after a CREATE sees the created node", () =>
    {
        const f = new ReadYourWritesFixture();
        const rows = f.Run("CREATE (:shop.Customer {name: 'Eve'}) WITH 1 AS x MATCH (n:shop.Customer) RETURN count(n) AS c");
        assert.deepEqual(rows, [[3]]);
    });

    test("a later clause reads a property of a node created earlier in the query", () =>
    {
        const f = new ReadYourWritesFixture();
        assert.deepEqual(f.Run("CREATE (n:shop.Customer {name: 'Eve'}) WITH n.name AS v RETURN v"), [["Eve"]]);
    });

    test("an ON CREATE action reads a property of the node its MERGE just created", () =>
    {
        const f = new ReadYourWritesFixture();
        assert.deepEqual(f.Run("MERGE (n:shop.Customer {name: 'Zed'}) ON CREATE SET n.email = n.name RETURN n.email"), [["Zed"]]);
    });

    test("SET items apply in order and see earlier items", () =>
    {
        const f = new ReadYourWritesFixture();
        assert.deepEqual(f.Run("MATCH (n:shop.Customer {name: 'Ada'}) SET n.tier = 'gold', n.email = n.tier RETURN n.email"), [["gold"]]);
    });

    test("SET n = {map} works on a node created in an earlier clause", () =>
    {
        const f = new ReadYourWritesFixture();
        const rows = f.Run("CREATE (n:shop.Customer {name: 'A', tier: 'x'}) SET n = {name: 'B'} RETURN n.name, n.tier");
        assert.deepEqual(rows, [["B", null]]);
    });

    test("a MATCH after SET filters on the new value", () =>
    {
        const f = new ReadYourWritesFixture();
        const rows = f.Run("MATCH (n:shop.Customer {name: 'Ada'}) SET n.tier = 'gold' WITH 1 AS x MATCH (m:shop.Customer) WHERE m.tier = 'gold' RETURN m.name");
        assert.deepEqual(rows, [["Ada"]]);
    });

    test("a MATCH after DELETE no longer sees the deleted node", () =>
    {
        const f = new ReadYourWritesFixture();
        // count(*) counts rows: a stale read would yield a row for Bob that only resolves to null after commit.
        const rows = f.Run("MATCH (n:shop.Customer {name: 'Bob'}) DELETE n WITH 1 AS x MATCH (m:shop.Customer) RETURN count(*) AS c");
        assert.deepEqual(rows, [[1]]);
    });

    test("a relationship created earlier in the query is traversable by a later MATCH", () =>
    {
        const f = new ReadYourWritesFixture();
        const rows = f.Run("MATCH (c:shop.Customer {name: 'Ada'}), (o:shop.Order {total: '10'}) CREATE (c)-[:orders]->(o) "
            + "WITH c MATCH (c)-[:orders]->(x) RETURN x.total");
        assert.deepEqual(rows, [["10"]]);
    });

    test("a relationship created earlier is traversable in reverse (incoming)", () =>
    {
        const f = new ReadYourWritesFixture();
        const rows = f.Run("MATCH (c:shop.Customer {name: 'Ada'}), (o:shop.Order {total: '10'}) CREATE (c)-[:orders]->(o) "
            + "WITH o MATCH (o)<-[:orders]-(who) RETURN who.name");
        assert.deepEqual(rows, [["Ada"]]);
    });

    test("reads feeding a write clause finish before it writes (no Halloween re-reads)", () =>
    {
        const f = new ReadYourWritesFixture();
        // 2 UNWIND rows x 2 pre-query customers = 4 creates; an interleaved read would see its own creates and make 6.
        f.Run("UNWIND [1, 2] AS i MATCH (n:shop.Customer) CREATE (:shop.Customer {name: 'x'})");
        assert.equal(f.Count("shop.Customer"), 6);
    });

    test("a later MERGE row matches the node an earlier row created", () =>
    {
        const f = new ReadYourWritesFixture();
        const rows = f.Run("UNWIND [1, 2] AS i MERGE (n:shop.Customer {name: 'Kai'}) ON CREATE SET n.tier = 'new' ON MATCH SET n.email = 'seen' RETURN n.tier, n.email");
        assert.deepEqual(rows, [["new", "seen"], ["new", "seen"]]);
        assert.equal(f.Count("shop.Customer"), 3);
    });
});
