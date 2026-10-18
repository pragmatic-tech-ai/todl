import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CypherParser } from "../parser.js";
import { CypherQuery, Pattern, Expr, Return } from "../fluent.js";
import { CypherQueryModel } from "../query-model.js";
import { CypherSemanticError } from "../errors.js";

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

    it("CREATE with several anchors comma-joins the paths", () =>
    {
        const q = CypherQuery.Create(Pattern.Node("a").Label("shop.Customer"), Pattern.Node("b").Label("shop.Order"));
        RoundTrip.Check(q, "CREATE (a:shop.Customer), (b:shop.Order)");
    });

    it("DELETE and DETACH DELETE with several variables", () =>
    {
        const m = Pattern.Node("a").Label("shop.Customer");
        const n = Pattern.Node("b").Label("shop.Order");
        RoundTrip.Check(CypherQuery.Match(m, n).Delete("a", "b"), "MATCH (a:shop.Customer), (b:shop.Order) DELETE a, b");
        RoundTrip.Check(CypherQuery.Match(m, n).DetachDelete("a", "b"), "MATCH (a:shop.Customer), (b:shop.Order) DETACH DELETE a, b");
    });

    it("REMOVE with several targets", () =>
    {
        const q = CypherQuery.Match(Pattern.Node("n").Label("shop.Customer")).Remove(Expr.Prop("n", "tier"), Expr.Prop("n", "note"));
        RoundTrip.Check(q, "MATCH (n:shop.Customer) REMOVE n.tier, n.note");
    });

    it("a write after WITH round-trips", () =>
    {
        const q = CypherQuery.Match(Pattern.Node("n").Label("shop.Customer"))
            .With(Return.Node("n"))
            .Create(Pattern.Node("o").Label("shop.Order"));
        RoundTrip.Check(q, "MATCH (n:shop.Customer) WITH n CREATE (o:shop.Order)");
    });

    it("Set rejects a non-property target", () =>
    {
        assert.throws(() => CypherQuery.Match(Pattern.Node("n")).Set(Expr.Var("n"), Expr.Lit(1)), CypherSemanticError);
        assert.throws(() => CypherQuery.Match(Pattern.Node("n")).Set(Expr.Var("n"), Expr.Lit(1)), /property access/);
    });

    it("Remove rejects a non-property target", () =>
    {
        assert.throws(() => CypherQuery.Match(Pattern.Node("n")).Remove(Expr.Var("n")), CypherSemanticError);
        assert.throws(() => CypherQuery.Match(Pattern.Node("n")).Remove(Expr.Var("n")), /property access/);
    });

    it("SetMerge rejects an empty variable", () =>
    {
        assert.throws(() => CypherQuery.Match(Pattern.Node("n")).SetMerge("", Expr.Map({})), CypherSemanticError);
    });

    it("Set after Return throws", () =>
    {
        assert.throws(() => CypherQuery.Match(Pattern.Node("n")).Return(Return.Node("n")).Set(Expr.Prop("n", "p"), Expr.Lit(1)), /no clauses may follow Return/);
    });

    it("a WITH-terminated query still needs RETURN", () =>
    {
        assert.throws(() => CypherQuery.Match(Pattern.Node("n")).With(Return.Node("n")).ToModel(), /requires a Return clause/);
    });
});
