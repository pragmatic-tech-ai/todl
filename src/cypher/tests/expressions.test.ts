import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Literal, Parameter, Comparison, BooleanExpression, VariableRef, IsNullExpression } from "../expressions.js";
import { ComparisonOp, BooleanOp } from "../enums.js";
import { Binding, EvalContext } from "../binding.js";
import { ScalarValue } from "../values.js";
import { CypherSemanticError } from "../errors.js";

class ExpressionTestHelper
{
    public static Ctx(params: [string, string | number | boolean][] = []): EvalContext
    {
        return new EvalContext(new Binding(), new Map(params));
    }

    public static Bool(v: unknown): unknown
    {
        return (v as ScalarValue).Value;
    }
}

describe("cypher expressions", () =>
{
    test("comparison across equal types", () =>
    {
        const expr = new Comparison(new Literal(2), ComparisonOp.Lt, new Literal(5));
        assert.equal(ExpressionTestHelper.Bool(expr.Evaluate(ExpressionTestHelper.Ctx())), true);
    });

    test("comparison across incompatible types is false, not a throw", () =>
    {
        const expr = new Comparison(new Literal("a"), ComparisonOp.Lt, new Literal(5));
        assert.equal(ExpressionTestHelper.Bool(expr.Evaluate(ExpressionTestHelper.Ctx())), false);
    });

    test("AND/OR/NOT truthiness, null treated as not-true", () =>
    {
        const t = new Literal(true);
        const f = new Literal(false);
        const c = ExpressionTestHelper.Ctx();
        assert.equal(ExpressionTestHelper.Bool(new BooleanExpression(BooleanOp.And, [t, f]).Evaluate(c)), false);
        assert.equal(ExpressionTestHelper.Bool(new BooleanExpression(BooleanOp.Or, [t, f]).Evaluate(c)), true);
        assert.equal(ExpressionTestHelper.Bool(new BooleanExpression(BooleanOp.Not, [f]).Evaluate(c)), true);
    });

    test("IS NULL on an absent variable", () =>
    {
        const expr = new IsNullExpression(new VariableRef("missing"), false);
        assert.equal(ExpressionTestHelper.Bool(expr.Evaluate(ExpressionTestHelper.Ctx())), true);
    });

    test("missing parameter throws CypherSemanticError", () =>
    {
        assert.throws(() => new Parameter("p").Evaluate(ExpressionTestHelper.Ctx()), CypherSemanticError);
    });

    test("CollectVariables gathers referenced names", () =>
    {
        const into = new Set<string>();
        new Comparison(new VariableRef("a"), ComparisonOp.Eq, new Literal(1)).CollectVariables(into);
        assert.deepEqual([...into], ["a"]);
    });
});
