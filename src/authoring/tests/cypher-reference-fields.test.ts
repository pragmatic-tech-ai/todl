import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../compiler-services/api.js";
import { CypherEngine } from "../../cypher/engine.js";
import { CypherSemanticError } from "../../cypher/errors.js";
import { ModelDraft } from "../model-draft.js";
import { ModelDraftBaker } from "../model-draft-baker.js";

// A field typed by a concept is a reference (an edge) in TODL — type-directed references — so Cypher must traverse it
// like a declared relationship.
class ReferenceFieldFixture
{
    private static readonly Meta = {
        uri: "shop.todl",
        text: `namespace shop {
            concept Customer { name : string?; orders : Order[]; }
            concept Order { total : string?; }
        }`,
    };

    private static readonly Model = `namespace app {
        import shop;
        model M : shop {
            Order o1 { total = "10"; }
            Customer c1 { name = "Ada"; orders = [o1]; }
        }
    }`;

    public static Engine(): CypherEngine
    {
        const base = check([ReferenceFieldFixture.Meta]).model;
        const draft = ModelDraft.fromSource([base], ReferenceFieldFixture.Model, { namespace: "app" });
        return new CypherEngine(ModelDraftBaker.Bake(draft));
    }

    public static Column(cypher: string): unknown[]
    {
        return ReferenceFieldFixture.Engine().Execute(cypher).Rows.map((r) => r[0]!.ToDto());
    }
}

describe("Cypher traverses reference-typed fields as relationships", () =>
{
    test("-[:field]-> follows a concept-typed field", () =>
    {
        assert.deepEqual(ReferenceFieldFixture.Column("MATCH (c:shop.Customer)-[:orders]->(o) RETURN o.total"), ["10"]);
    });

    test("bare --> includes reference fields", () =>
    {
        assert.deepEqual(ReferenceFieldFixture.Column("MATCH (c:shop.Customer)-->(o) RETURN o.total"), ["10"]);
    });

    test("<-[:field]- follows a reference field backwards", () =>
    {
        assert.deepEqual(ReferenceFieldFixture.Column("MATCH (o:shop.Order)<-[:orders]-(c) RETURN c.name"), ["Ada"]);
    });

    test("a scalar field is still not a relationship type", () =>
    {
        assert.throws(() => ReferenceFieldFixture.Engine().Execute("MATCH (c:shop.Customer)-[:name]->(x) RETURN x"), CypherSemanticError);
    });
});
