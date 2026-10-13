import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CypherParser } from "../parser.js";
import { MatchClause } from "../query-model.js";
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
