import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CypherQuery, Pattern, Expr, Return, Fn, Sort, Hops } from "../fluent.js";
import { CypherSemanticError } from "../errors.js";
import { CypherParser } from "../parser.js";
import { FunctionCall } from "../expressions.js";
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

    test("aggregate helpers Sum/Avg/Min/Max match the parser", () =>
    {
        const built = CypherQuery.Match(Pattern.Node("a").Label("Service"))
            .Return(
                Fn.Sum(Expr.Prop("a", "x")).As("s"),
                Fn.Avg(Expr.Prop("a", "x")).As("v"),
                Fn.Min(Expr.Prop("a", "x")).As("lo"),
                Fn.Max(Expr.Prop("a", "x")).As("hi"))
            .ToModel();
        const parsed = new CypherParser("MATCH (a:Service) RETURN sum(a.x) AS s, avg(a.x) AS v, min(a.x) AS lo, max(a.x) AS hi").Parse();
        assert.deepStrictEqual(built, parsed);
        const names = built.Parts[0]!.Projection.Items.map((i) => (i.Expr as FunctionCall).Name);
        assert.deepEqual(names, ["sum", "avg", "min", "max"]);
    });

    test("Coalesce and Call match the parser", () =>
    {
        const built = CypherQuery.Match(Pattern.Node("a").Label("Service"))
            .Return(
                Fn.Coalesce(Expr.Prop("a", "x"), Expr.Lit(0)).As("c"),
                Fn.Call("toUpper", Expr.Prop("a", "name")).As("u"),
                Fn.Call("range", Expr.Lit(1), Expr.Lit(3)).As("r"))
            .ToModel();
        const parsed = new CypherParser("MATCH (a:Service) RETURN coalesce(a.x, 0) AS c, toUpper(a.name) AS u, range(1, 3) AS r").Parse();
        assert.deepStrictEqual(built, parsed);
    });

    test("arithmetic builders Add/Sub/Mul/Div/Mod match the parser", () =>
    {
        const x = () => Expr.Prop("a", "x");
        const built = CypherQuery.Match(Pattern.Node("a").Label("Service"))
            .Return(
                Return.Item(x().Add(Expr.Lit(1)), "p"),
                Return.Item(x().Sub(Expr.Lit(2)), "q"),
                Return.Item(x().Mul(Expr.Lit(3)), "r"),
                Return.Item(x().Div(Expr.Lit(4)), "s"),
                Return.Item(x().Mod(Expr.Lit(5)), "t"),
                Return.Item(x().Add(Expr.Lit(1)).Mul(Expr.Lit(2)), "u"))
            .ToModel();
        const parsed = new CypherParser("MATCH (a:Service) RETURN a.x + 1 AS p, a.x - 2 AS q, a.x * 3 AS r, a.x / 4 AS s, a.x % 5 AS t, (a.x + 1) * 2 AS u").Parse();
        assert.deepStrictEqual(built, parsed);
    });

    test("At(index), Map and List builders match the parser", () =>
    {
        const built = CypherQuery.Match(Pattern.Node("a").Label("Service"))
            .Return(
                Return.Item(Expr.List(Expr.Lit(10), Expr.Lit(20)).At(Expr.Lit(1)), "i"),
                Return.Item(Expr.Map({ k: Expr.Prop("a", "x"), j: Expr.Lit("v") }), "m"),
                Return.Item(Expr.Map({ k: Expr.Lit(5) }).At(Expr.Lit("k")), "mk"))
            .ToModel();
        const parsed = new CypherParser("MATCH (a:Service) RETURN [10, 20][1] AS i, {k: a.x, j: 'v'} AS m, {k: 5}['k'] AS mk").Parse();
        assert.deepStrictEqual(built, parsed);
    });

    test("Return.Item takes an expression and an optional alias", () =>
    {
        const aliased = Return.Item(Expr.Prop("a", "x").Add(Expr.Lit(1)), "n");
        assert.equal(aliased.Alias, "n");
        assert.equal(aliased.ColumnName(), "n");
        const bare = Return.Item(Expr.Prop("a", "x"));
        assert.equal(bare.Alias, undefined);
        assert.equal(bare.ColumnName(), "a.x");
    });

    test("With(...).Where(...) matches the parser and guards duplicates and Return", () =>
    {
        const built = CypherQuery
            .Match(Pattern.Node("a").Label("Service"))
            .OptionalMatch(Pattern.Node("a").Out("calls", Pattern.Node("b")))
            .With(Expr.Prop("a", "name").As("n"), Fn.CountOf(Expr.Var("b")).As("c"))
            .Where(Expr.Var("c").Gt(0))
            .Return(Return.Node("n"), Return.Node("c"))
            .ToModel();
        const parsed = new CypherParser(
            "MATCH (a:Service) OPTIONAL MATCH (a)-[:calls]->(b) WITH a.name AS n, count(b) AS c WHERE c > 0 RETURN n, c").Parse();
        assert.deepStrictEqual(built, parsed);
        const open = CypherQuery.Match(Pattern.Node("a")).With(Return.Node("a")).Where(Expr.Var("a").Eq(1));
        assert.throws(() => open.Where(Expr.Var("a").Eq(2)), /already specified for this With/);
        assert.throws(() => CypherQuery.Match(Pattern.Node("a")).Return(Return.Node("a")).Where(Expr.Var("a").Eq(1)), /directly follow a Match/);
    });

    test("fluent relationship variable matches the text parser", () =>
    {
        const built = CypherQuery
            .Match(Pattern.Node("a").Label("Service").Out("calls", Pattern.Node("b").Label("Service"), undefined, "r"))
            .Return(Return.Node("a"), Return.Node("r"))
            .ToModel();
        const parsed = new CypherParser("MATCH (a:Service)-[r:calls]->(b:Service) RETURN a, r").Parse();
        assert.deepStrictEqual(built, parsed);
        assert.equal((built.Parts[0]!.Reading[0] as MatchClause).Paths[0]!.Rels[0]!.Variable, "r");
        const inc = CypherQuery.Match(Pattern.Node("a").In("calls", Pattern.Node("b"), Hops.Range(1, 2), "r")).Return(Return.Node("r")).ToModel();
        assert.deepStrictEqual(inc, new CypherParser("MATCH (a)<-[r:calls*1..2]-(b) RETURN r").Parse());
        const und = CypherQuery.Match(Pattern.Node("a").Undirected("calls", Pattern.Node("b"), undefined, "r")).Return(Return.Node("r")).ToModel();
        assert.deepStrictEqual(und, new CypherParser("MATCH (a)-[r:calls]-(b) RETURN r").Parse());
    });

    test("Expr.Param matches the text parser in WHERE, projection and UNWIND", () =>
    {
        const where = CypherQuery.Match(Pattern.Node("a").Label("Service"))
            .Where(Expr.Prop("a", "name").Eq("x")).Return(Expr.Param("x").As("p")).ToModel();
        assert.deepStrictEqual(where, new CypherParser("MATCH (a:Service) WHERE a.name = 'x' RETURN $x AS p").Parse());
        const idx = CypherQuery.Unwind(Expr.Param("xs"), "x").Return(Expr.Param("xs").At(Expr.Lit(1)).As("second")).ToModel();
        assert.deepStrictEqual(idx, new CypherParser("UNWIND $xs AS x RETURN $xs[1] AS second").Parse());
    });

    test("consecutive WITH builds an empty middle reading like the parser", () =>
    {
        const built = CypherQuery.Match(Pattern.Node("a").Label("Service"))
            .With(Return.Node("a")).With(Return.Node("a")).Return(Return.Node("a")).ToModel();
        const parsed = new CypherParser("MATCH (a:Service) WITH a WITH a RETURN a").Parse();
        assert.deepStrictEqual(built, parsed);
        assert.equal(built.Parts.length, 3);
        assert.equal(built.Parts[1]!.Reading.length, 0);
    });
});
