import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../compiler-services/api.js";
import { FakeIdGenerator } from "../../compiler-services/model/tests/fake-id-generator.js";
import { CypherSemanticError } from "../../cypher/errors.js";
import type { CypherResult } from "../../cypher/result.js";
import { ModelDraft } from "../model-draft.js";
import { DraftCypherHarness, DraftTestWriter } from "./draft-cypher-harness.js";

class MergePathFixture
{
    private static readonly Meta = {
        uri: "shop.todl",
        text: `namespace shop {
            concept Customer { name : string?; tier : string?; orders : Order[]; }
            concept Order { total : string?; }
        }`,
    };

    private static readonly Model = `namespace app {
        import shop;
        model M : shop {
            Customer c1 { name = "Ada"; }
            Customer c2 { name = "Bob"; }
            Order o1 { total = "10"; }
        }
    }`;

    public readonly Draft: ModelDraft;
    public readonly Writer: DraftTestWriter;

    constructor()
    {
        const base = check([MergePathFixture.Meta]).model;
        this.Draft = ModelDraft.fromSource([base], MergePathFixture.Model, { namespace: "app" });
        this.Writer = new DraftTestWriter(this.Draft, new FakeIdGenerator());
    }

    public Exec(cypher: string): CypherResult
    {
        return DraftCypherHarness.Engine(this.Draft, this.Writer).Execute(cypher);
    }

    public Rows(cypher: string): unknown[][]
    {
        return this.Exec(cypher).Rows.map((row) => row.map((v) => v.ToDto()));
    }

    public Count(cypher: string): number
    {
        return this.Rows(cypher)[0]![0] as number;
    }
}

describe("Cypher MERGE over a relationship path", () =>
{
    const link = "MATCH (c:shop.Customer {name: 'Ada'}), (o:shop.Order {total: '10'}) MERGE (c)-[:orders]->(o)";
    const adaOrders = "MATCH (c:shop.Customer {name: 'Ada'})-[:orders]->(o) RETURN count(o) AS n";

    test("merging a path between bound nodes creates the edge once, then matches it", () =>
    {
        const f = new MergePathFixture();
        assert.equal(f.Exec(link).Stats!.RelationshipsCreated, 1);
        assert.equal(f.Exec(link).Stats!.RelationshipsCreated, 0);
        assert.equal(f.Count(adaOrders), 1);
    });

    test("a missing end node is created with the edge, and found again on the next run", () =>
    {
        const f = new MergePathFixture();
        const q = "MATCH (c:shop.Customer {name: 'Ada'}) MERGE (c)-[:orders]->(o:shop.Order {total: '99'}) RETURN o.total";
        assert.deepEqual(f.Rows(q), [["99"]]);
        assert.deepEqual(f.Rows(q), [["99"]]);
        assert.equal(f.Count("MATCH (o:shop.Order {total: '99'}) RETURN count(o) AS n"), 1);
    });

    test("the whole path is matched or the whole path is created (an unlinked lookalike node is not reused)", () =>
    {
        const f = new MergePathFixture();
        f.Exec("MATCH (b:shop.Customer {name: 'Bob'}) MERGE (b)-[:orders]->(o:shop.Order {total: '10'})");
        assert.equal(f.Count("MATCH (o:shop.Order {total: '10'}) RETURN count(o) AS n"), 2);
    });

    test("ON CREATE runs on the creating run and ON MATCH on the next", () =>
    {
        const f = new MergePathFixture();
        const q = `${link} ON CREATE SET c.tier = 'linked' ON MATCH SET c.tier = 'relinked' RETURN c.tier`;
        assert.deepEqual(f.Rows(q), [["linked"]]);
        assert.deepEqual(f.Rows(q), [["relinked"]]);
    });

    test("a relationship variable binds the merged edge", () =>
    {
        const f = new MergePathFixture();
        assert.deepEqual(f.Rows(`MATCH (c:shop.Customer {name: 'Ada'}), (o:shop.Order {total: '10'}) MERGE (c)-[r:orders]->(o) RETURN count(r) AS n`), [[1]]);
    });

    test("a later row in the same query matches the path an earlier row created", () =>
    {
        const f = new MergePathFixture();
        f.Exec("UNWIND [1, 2] AS i MATCH (c:shop.Customer {name: 'Ada'}) MERGE (c)-[:orders]->(o:shop.Order {total: '77'})");
        assert.equal(f.Count("MATCH (o:shop.Order {total: '77'}) RETURN count(o) AS n"), 1);
    });

    test("MERGE yields every match, running ON MATCH for each", () =>
    {
        const f = new MergePathFixture();
        const rows = f.Rows("MERGE (n:shop.Customer) ON MATCH SET n.tier = 'm' RETURN n.name, n.tier ORDER BY n.name");
        assert.deepEqual(rows, [["Ada", "m"], ["Bob", "m"]]);
    });

    test("invalid MERGE paths fail before writing anything", () =>
    {
        const f = new MergePathFixture();
        const bad = [
            "MATCH (c:shop.Customer {name: 'Ada'}) MERGE (c)-[:orders]-(o:shop.Order {total: '1'})",
            "MATCH (c:shop.Customer {name: 'Ada'}) MERGE (c)-->(o:shop.Order {total: '1'})",
            "MATCH (c:shop.Customer {name: 'Ada'}) MERGE (c)-[:orders*]->(o:shop.Order {total: '1'})",
            "MATCH (c:shop.Customer {name: 'Ada'}) MERGE (c:shop.Customer {tier: 'x'})-[:orders]->(o:shop.Order {total: '1'})",
        ];
        for (const q of bad) assert.throws(() => f.Exec(q), CypherSemanticError, q);
        assert.equal(f.Count("MATCH (o:shop.Order) RETURN count(o) AS n"), 1);
    });
});

describe("Cypher CREATE binds relationship variables", () =>
{
    test("a relationship variable in CREATE is bound to the created edge", () =>
    {
        const f = new MergePathFixture();
        assert.deepEqual(f.Rows("MATCH (c:shop.Customer {name: 'Bob'}), (o:shop.Order {total: '10'}) CREATE (c)-[r:orders]->(o) RETURN count(r) AS n"), [[1]]);
    });
});
