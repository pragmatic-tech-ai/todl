import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CypherQuery, Pattern, Expr, Return, Fn, Sort, Hops, CypherParser } from "../index.js";
import type { ExprArg } from "../index.js";

// Proves the public package surface (everything reached through ./index.js) is sufficient to build an
// aggregate projection and a variable-length hop — the SP2 builders Fn, Sort and Hops, plus the ExprArg type.
describe("cypher public surface", () =>
{
    test("Fn, Sort, Hops and ExprArg build an aggregate + variable-length query through index.js", () =>
    {
        const built = CypherQuery
            .Match(Pattern.Node("a").Label("Service").Out("calls", Pattern.Node("b").Label("Service"), Hops.Range(1, 3)))
            .Return(Return.Prop("b", "name", "n"), Fn.Count().As("c"), Fn.Collect(Expr.Prop("b", "name")).As("names"))
            .OrderBy(Sort.By(Expr.Var("c"), true))
            .ToModel();
        const parsed = new CypherParser(
            "MATCH (a:Service)-[:calls*1..3]->(b:Service) RETURN b.name AS n, count(*) AS c, collect(b.name) AS names ORDER BY c DESC").Parse();
        assert.deepStrictEqual(built, parsed);

        // ExprArg is part of the public fluent method signatures; naming it here proves the type is exported too.
        const arg: ExprArg = Expr.Var("c");
        assert.ok(Sort.By(arg) !== undefined);
    });
});
