import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CypherParser } from "../parser.js";
import { MatchClause, UnwindClause } from "../query-model.js";
import { CypherSyntaxError } from "../errors.js";
import { FunctionCall } from "../expressions.js";

describe("cypher parser SP2 (query-part loop + projection)", () =>
{
    test("WITH then RETURN produces two query parts", () =>
    {
        const model = new CypherParser("MATCH (a) WITH a AS a2 RETURN a2").Parse();
        assert.equal(model.Parts.length, 2);
        assert.equal(model.Parts[0]!.Projection.IsReturn, false);
        assert.equal(model.Parts[0]!.Projection.Items[0]!.Alias, "a2");
        assert.ok(model.Parts[0]!.Reading[0] instanceof MatchClause);
        assert.equal(model.Parts[1]!.Projection.IsReturn, true);
        assert.equal(model.Parts[1]!.Reading.length, 0);
        assert.deepEqual(model.FinalColumns(), ["a2"]);
    });

    test("DISTINCT + ORDER BY ... DESC + SKIP + LIMIT parse onto the projection", () =>
    {
        const model = new CypherParser("MATCH (a) RETURN DISTINCT a.x ORDER BY a.x DESC SKIP 1 LIMIT 2").Parse();
        const proj = model.Parts[0]!.Projection;
        assert.equal(proj.Distinct, true);
        assert.equal(proj.OrderBy?.length, 1);
        assert.equal(proj.OrderBy?.[0]!.Descending, true);
        assert.ok(proj.Skip !== undefined);
        assert.ok(proj.Limit !== undefined);
    });

    test("single-part query parses to exactly one QueryPart (regression)", () =>
    {
        const model = new CypherParser("MATCH (a:Service) WHERE a.name = 'x' RETURN a").Parse();
        assert.equal(model.Parts.length, 1);
        const match = model.Parts[0]!.Reading[0] as MatchClause;
        assert.equal(match.Paths[0]!.Nodes[0]!.Label, "Service");
        assert.ok(match.Where !== undefined);
    });

    test("function call with DISTINCT and star parse into FunctionCall", () =>
    {
        const star = new CypherParser("MATCH (a) RETURN count(*)").Parse();
        const starCall = star.Parts[0]!.Projection.Items[0]!.Expr as FunctionCall;
        assert.ok(starCall instanceof FunctionCall);
        assert.equal(starCall.Star, true);

        const distinct = new CypherParser("MATCH (a) RETURN count(DISTINCT a.x)").Parse();
        const distinctCall = distinct.Parts[0]!.Projection.Items[0]!.Expr as FunctionCall;
        assert.equal(distinctCall.Distinct, true);
        assert.equal(distinctCall.Args.length, 1);
    });

    test("a WITH with no following RETURN is a syntax error", () =>
    {
        assert.throws(() => new CypherParser("MATCH (a) WITH a AS a2").Parse(), CypherSyntaxError);
    });
});

describe("cypher parser SP2 (OPTIONAL MATCH, UNWIND, multi-path MATCH)", () =>
{
    test("OPTIONAL MATCH yields a MatchClause flagged Optional", () =>
    {
        const model = new CypherParser("OPTIONAL MATCH (a)-[:x]->(b) RETURN a, b").Parse();
        const match = model.Parts[0]!.Reading[0] as MatchClause;
        assert.ok(match instanceof MatchClause);
        assert.equal(match.Optional, true);
        assert.equal(match.Paths[0]!.Rels.length, 1);
    });

    test("plain MATCH is not Optional", () =>
    {
        const match = new CypherParser("MATCH (a) RETURN a").Parse().Parts[0]!.Reading[0] as MatchClause;
        assert.equal(match.Optional, false);
    });

    test("UNWIND expr AS v yields an UnwindClause (range() used; list literals are Task 17)", () =>
    {
        const model = new CypherParser("UNWIND range(1, 3) AS x RETURN x").Parse();
        const unwind = model.Parts[0]!.Reading[0] as UnwindClause;
        assert.ok(unwind instanceof UnwindClause);
        assert.equal(unwind.Variable, "x");
        assert.ok(unwind.Expr instanceof FunctionCall);
    });

    test("MATCH a, b yields one MatchClause with two paths", () =>
    {
        const model = new CypherParser("MATCH (a:Service), (b:Service) RETURN a, b").Parse();
        assert.equal(model.Parts[0]!.Reading.length, 1);
        assert.equal((model.Parts[0]!.Reading[0] as MatchClause).Paths.length, 2);
    });

    test("MATCH then OPTIONAL MATCH yields two reading clauses", () =>
    {
        const model = new CypherParser("MATCH (a) OPTIONAL MATCH (a)-[:x]->(b) RETURN a, b").Parse();
        const reading = model.Parts[0]!.Reading;
        assert.equal(reading.length, 2);
        assert.equal((reading[0] as MatchClause).Optional, false);
        assert.equal((reading[1] as MatchClause).Optional, true);
    });

    test("mixed MATCH / UNWIND sequence", () =>
    {
        const model = new CypherParser("MATCH (a) UNWIND range(1, 2) AS x MATCH (b) RETURN a, x, b").Parse();
        const reading = model.Parts[0]!.Reading;
        assert.equal(reading.length, 3);
        assert.ok(reading[1] instanceof UnwindClause);
    });

    test("OPTIONAL not followed by MATCH is a syntax error", () =>
    {
        assert.throws(() => new CypherParser("OPTIONAL (a) RETURN a").Parse(), CypherSyntaxError);
    });
});
