import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CypherQuery, Pattern, Expr, Return, Fn, Sort, Hops } from "../fluent.js";
import { CypherSemanticError } from "../errors.js";
import { CypherParser } from "../parser.js";
import { MatchClause, UnwindClause, CypherQueryModel } from "../query-model.js";

class ParityChecker
{
    public static readonly Text =
        "MATCH p = (a:Service)-[:calls*1..3]->(b:Service) WHERE a.name = 'checkout' "
        + "WITH a, count(*) AS c ORDER BY c DESC LIMIT 5 "
        + "OPTIONAL MATCH (a)-[:owns]->(t:Team) UNWIND [1, 2] AS x "
        + "RETURN DISTINCT a.name, c, collect(t.name) AS teams ORDER BY c SKIP 1 LIMIT 2";

    public static Built(): CypherQueryModel
    {
        return CypherQuery
            .Match(Pattern.Node("a").Label("Service").Out("calls", Pattern.Node("b").Label("Service"), Hops.Range(1, 3)).AsPath("p"))
            .Where(Expr.Prop("a", "name").Eq("checkout"))
            .With(Return.Node("a"), Fn.Count().As("c"))
            .OrderBy(Expr.Var("c").Desc())
            .Limit(5)
            .OptionalMatch(Pattern.Node("a").Out("owns", Pattern.Node("t").Label("Team")))
            .Unwind(Expr.List(Expr.Lit(1), Expr.Lit(2)), "x")
            .Return(Return.Prop("a", "name"), Return.Node("c"), Fn.Collect(Expr.Prop("t", "name")).As("teams"))
            .Distinct()
            .OrderBy(Sort.By(Expr.Var("c")))
            .Skip(1)
            .Limit(2)
            .ToModel();
    }

    public static CheckHops(h: Hops, text: string): void
    {
        const b = CypherQuery.Match(Pattern.Node("a").Out("r", Pattern.Node("b"), h)).Return(Return.Node("b")).ToModel();
        const p = new CypherParser(`MATCH (a)-[:r${text}]->(b) RETURN b`).Parse();
        const br = (b.Parts[0]!.Reading[0] as MatchClause).Paths[0]!.Rels[0]!;
        const pr = (p.Parts[0]!.Reading[0] as MatchClause).Paths[0]!.Rels[0]!;
        assert.equal(br.MinHops, pr.MinHops);
        assert.equal(br.MaxHops, pr.MaxHops);
    }
}

describe("cypher fluent SP2 read-plus", () =>
{
    test("multi-part fluent model matches the parser", () =>
    {
        const built = ParityChecker.Built();
        const parsed = new CypherParser(ParityChecker.Text).Parse();
        assert.equal(built.Parts.length, 2);
        assert.equal(built.Parts.length, parsed.Parts.length);
        for (let i = 0; i < parsed.Parts.length; i++)
        {
            const b = built.Parts[i]!;
            const p = parsed.Parts[i]!;
            assert.deepEqual(b.Reading.map((r) => r.constructor.name), p.Reading.map((r) => r.constructor.name));
            assert.deepEqual(b.Projection.Items.map((x) => x.ColumnName()), p.Projection.Items.map((x) => x.ColumnName()));
            assert.equal(b.Projection.Distinct, p.Projection.Distinct);
            assert.equal(b.Projection.IsReturn, p.Projection.IsReturn);
            assert.equal(b.Projection.OrderBy?.length, p.Projection.OrderBy?.length);
            assert.deepEqual(b.Projection.OrderBy?.map((s) => s.Descending), p.Projection.OrderBy?.map((s) => s.Descending));
            assert.deepEqual(b.Projection.Skip, p.Projection.Skip);
            assert.deepEqual(b.Projection.Limit, p.Projection.Limit);
        }
        const bm = built.Parts[0]!.Reading[0] as MatchClause;
        const pm = parsed.Parts[0]!.Reading[0] as MatchClause;
        assert.equal(bm.Paths[0]!.PathVariable, "p");
        assert.equal(bm.Paths[0]!.Rels[0]!.MinHops, pm.Paths[0]!.Rels[0]!.MinHops);
        assert.equal(bm.Paths[0]!.Rels[0]!.MaxHops, pm.Paths[0]!.Rels[0]!.MaxHops);
        assert.ok(bm.Where !== undefined);
        assert.equal((built.Parts[1]!.Reading[0] as MatchClause).Optional, true);
        assert.ok(built.Parts[1]!.Reading[1] instanceof UnwindClause);
    });

    test("whole model is deeply equal to the parsed model", () =>
    {
        assert.deepStrictEqual(ParityChecker.Built(), new CypherParser(ParityChecker.Text).Parse());
    });

    test("SP1 shape still lowers to one part", () =>
    {
        const m = CypherQuery.Match(Pattern.Node("a").Label("S")).Return(Return.Node("a")).ToModel();
        assert.equal(m.Parts.length, 1);
        assert.equal(m.Parts[0]!.Projection.IsReturn, true);
    });

    test("ToModel requires a Return", () =>
    {
        assert.throws(() => CypherQuery.Match(Pattern.Node("a")).With(Return.Node("a")).ToModel());
    });

    test("a second Where on the same Match throws instead of replacing the first", () =>
    {
        const q = CypherQuery.Match(Pattern.Node("a")).Where(Expr.Prop("a", "name").Eq("x"));
        assert.throws(() => q.Where(Expr.Prop("a", "name").Eq("y")));
    });

    test("Hops.Range throws when min exceeds max", () =>
    {
        assert.throws(() => Hops.Range(3, 1), CypherSemanticError);
        assert.doesNotThrow(() => Hops.Range(2, 2));
    });

    test("ToModel returns a defensive copy of the reading clauses", () =>
    {
        const q = CypherQuery.Match(Pattern.Node("a")).Return(Return.Node("a"));
        const model = q.ToModel();
        const before = model.Parts[0]!.Reading.length;
        // Simulate later mutation of the builder's internal reading list.
        (q as unknown as { reading: unknown[] }).reading.push(new UnwindClause(Expr.Lit(1) as never, "x"));
        assert.equal(model.Parts[0]!.Reading.length, before);
    });

    test("variable-length helpers match parser hop defaults", () =>
    {
        ParityChecker.CheckHops(Hops.Any(), "*");
        ParityChecker.CheckHops(Hops.Exactly(2), "*2");
        ParityChecker.CheckHops(Hops.AtLeast(2), "*2..");
    });
});
