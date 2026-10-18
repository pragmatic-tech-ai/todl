import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CypherParser } from "../parser.js";
import { CypherQuery, Pattern, Expr, Return } from "../fluent.js";
import { CypherQueryModel } from "../query-model.js";

class RoundTrip
{
    // Structural fingerprint: clause class names plus their rendered content, ignoring object identity.
    public static Shape(model: CypherQueryModel): string
    {
        return JSON.stringify(model.Parts, (key, value) =>
        {
            if (value instanceof Map) return [...value];
            if (value !== null && typeof value === "object" && !Array.isArray(value) && value.constructor !== Object)
            {
                return { $: value.constructor.name, ...value };
            }
            return value;
        });
    }

    public static Check(q: CypherQuery, expectedText: string): void
    {
        const text = q.ToCypherText();
        assert.equal(text, expectedText);
        const reparsed = new CypherParser(text).Parse();
        assert.equal(RoundTrip.Shape(reparsed), RoundTrip.Shape(q.ToModel()));
    }
}

describe("cypher write fluent + unparser round-trip", () =>
{
    it("CREATE with props, no RETURN", () =>
    {
        const q = CypherQuery.Create(Pattern.Node("n").Label("shop.Customer").Prop("name", "Ada"));
        RoundTrip.Check(q, "CREATE (n:shop.Customer {name: 'Ada'})");
        assert.equal(q.ToModel().HasWrites(), true);
        assert.equal(q.ToModel().Parts[0]!.Projection, undefined);
    });

    it("MATCH ... CREATE relationship ... RETURN", () =>
    {
        const q = CypherQuery.Match(Pattern.Node("a").Label("shop.Customer"))
            .Create(Pattern.Node("a").Out("orders", Pattern.Node("o").Label("shop.Order")))
            .Return(Return.Node("o"));
        RoundTrip.Check(q, "MATCH (a:shop.Customer) CREATE (a)-[:orders]->(o:shop.Order) RETURN o");
    });

    it("MERGE", () =>
    {
        const q = CypherQuery.Merge(Pattern.Node("c").Label("shop.Customer").Prop("email", "a@b.c"));
        RoundTrip.Check(q, "MERGE (c:shop.Customer {email: 'a@b.c'})");
    });

    it("SET property and += map", () =>
    {
        const q = CypherQuery.Match(Pattern.Node("n").Label("shop.Customer"))
            .Set(Expr.Prop("n", "tier"), Expr.Lit("gold"))
            .SetMerge("n", Expr.Map({ active: Expr.Lit(true) }))
            .Return(Return.Node("n"));
        RoundTrip.Check(q, "MATCH (n:shop.Customer) SET n.tier = 'gold', n += {active: TRUE} RETURN n");
    });

    it("DELETE and DETACH DELETE", () =>
    {
        RoundTrip.Check(CypherQuery.Match(Pattern.Node("n").Label("shop.Order")).Delete("n"), "MATCH (n:shop.Order) DELETE n");
        RoundTrip.Check(CypherQuery.Match(Pattern.Node("n").Label("shop.Customer")).DetachDelete("n"), "MATCH (n:shop.Customer) DETACH DELETE n");
    });

    it("REMOVE", () =>
    {
        const q = CypherQuery.Match(Pattern.Node("n").Label("shop.Customer")).Remove(Expr.Prop("n", "tier"));
        RoundTrip.Check(q, "MATCH (n:shop.Customer) REMOVE n.tier");
    });

    it("quoted string value round-trips", () =>
    {
        const q = CypherQuery.Match(Pattern.Node("n").Label("shop.Customer")).Set(Expr.Prop("n", "note"), Expr.Lit("a'b"));
        RoundTrip.Check(q, "MATCH (n:shop.Customer) SET n.note = 'a''b'");
        const set = new CypherParser(q.ToCypherText()).Parse().Parts[0]!.Reading[1] as any;
        assert.equal(set.Items[0].Value.Value, "a'b");
    });

    it("Set rejects a non-property target; WITH-terminated query still needs RETURN", () =>
    {
        assert.throws(() => CypherQuery.Match(Pattern.Node("n")).Set(Expr.Var("n"), Expr.Lit(1)));
        assert.throws(() => CypherQuery.Match(Pattern.Node("n")).With(Return.Node("n")).ToModel());
    });
});
