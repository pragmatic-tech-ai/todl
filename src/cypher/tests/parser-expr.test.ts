import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CypherParser } from "../parser.js";
import { EvalContext, Binding } from "../binding.js";
import { ScalarValue, NullValue } from "../values.js";
import { CypherSyntaxError } from "../errors.js";
import { ListValue } from "../values-structured.js";

class ExprHelper
{
    public static Eval(query: string): unknown
    {
        const model = new CypherParser(query).Parse();
        const expr = model.Parts[0]!.Projection.Items[0]!.Expr;
        const value = expr.Evaluate(new EvalContext(new Binding(), new Map()));
        if (value instanceof ScalarValue) return value.Value;
        if (value instanceof NullValue) return null;
        return value;
    }
}

describe("cypher parser expressions (arithmetic, list/map, index, NULL)", () =>
{
    test("multiplication binds tighter than addition", () =>
    {
        assert.equal(ExprHelper.Eval("RETURN 1 + 2 * 3"), 7);
        assert.equal(ExprHelper.Eval("RETURN (1 + 2) * 3"), 9);
    });

    test("left associativity and mod/div", () =>
    {
        assert.equal(ExprHelper.Eval("RETURN 10 - 3 - 2"), 5);
        assert.equal(ExprHelper.Eval("RETURN 10 / 2 % 3"), 2);
    });

    test("unary minus", () =>
    {
        assert.equal(ExprHelper.Eval("RETURN -3 + 1"), -2);
    });

    test("string concatenation", () =>
    {
        assert.equal(ExprHelper.Eval("RETURN 'a' + 'b'"), "ab");
    });

    test("list literal, index, and chained index", () =>
    {
        assert.equal(ExprHelper.Eval("RETURN [1,2,3][1]"), 2);
        assert.equal(ExprHelper.Eval("RETURN [[1,2],[3,4]][1][0]"), 3);
        assert.ok(ExprHelper.Eval("RETURN [1, 2]") instanceof ListValue);
        assert.ok(ExprHelper.Eval("RETURN []") instanceof ListValue);
    });

    test("map literal with property access", () =>
    {
        assert.equal(ExprHelper.Eval("RETURN {k: 7}.k"), 7);
        assert.equal(ExprHelper.Eval("RETURN {k: 7}['k']"), 7);
    });

    test("NULL literal", () =>
    {
        assert.equal(ExprHelper.Eval("RETURN NULL"), null);
        assert.doesNotThrow(() => new CypherParser("MATCH (a) WHERE a.x = NULL RETURN a").Parse());
    });

    test("comparison binds looser than arithmetic", () =>
    {
        assert.equal(ExprHelper.Eval("RETURN 1 + 2 > 2"), true);
        assert.doesNotThrow(() => new CypherParser("MATCH (a) WHERE a.x + 1 > 2 RETURN a").Parse());
    });

    test("IN list still parses; relationship brackets unaffected", () =>
    {
        assert.doesNotThrow(() => new CypherParser("MATCH (a)-[r:x]->(b) WHERE a.n IN ['p','q'] RETURN b").Parse());
    });

    test("dangling operator is a syntax error", () =>
    {
        assert.throws(() => new CypherParser("RETURN 1 +").Parse(), CypherSyntaxError);
    });
});
