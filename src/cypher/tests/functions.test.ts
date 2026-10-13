import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FunctionCall, Literal } from "../expressions.js";
import { Binding, EvalContext } from "../binding.js";
import { ScalarValue, NullValue } from "../values.js";
import { ListValue } from "../values-structured.js";
import { CypherSemanticError } from "../errors.js";

class H
{
    public static Ctx(): EvalContext
    {
        return new EvalContext(new Binding(), new Map());
    }

    public static Fn(n: string, ...a: unknown[]): FunctionCall
    {
        return new FunctionCall(n, a.map((v) => new Literal(v as never)), false, false);
    }
}

describe("functions", () =>
{
    test("coalesce returns first non-null", () =>
    {
        const f = new FunctionCall("coalesce", [new Literal(null), new Literal(5)], false, false);
        assert.equal((f.Evaluate(H.Ctx()) as ScalarValue).Value, 5);
    });
    test("toUpper / size / range / head", () =>
    {
        assert.equal((H.Fn("toUpper", "ab").Evaluate(H.Ctx()) as ScalarValue).Value, "AB");
        assert.equal((H.Fn("size", "abc").Evaluate(H.Ctx()) as ScalarValue).Value, 3);
        const r = new FunctionCall("range", [new Literal(1), new Literal(3)], false, false).Evaluate(H.Ctx());
        assert.ok(r instanceof ListValue && r.Items.length === 3);
        const h = new FunctionCall("head", [new FunctionCall("range", [new Literal(7), new Literal(9)], false, false)], false, false).Evaluate(H.Ctx());
        assert.equal((h as ScalarValue).Value, 7);
    });
    test("string helpers and bad args", () =>
    {
        assert.equal((H.Fn("substring", "hello", 1, 3).Evaluate(H.Ctx()) as ScalarValue).Value, "ell");
        assert.equal((H.Fn("replace", "aXa", "X", "-").Evaluate(H.Ctx()) as ScalarValue).Value, "a-a");
        assert.equal((H.Fn("toInteger", "42").Evaluate(H.Ctx()) as ScalarValue).Value, 42);
        assert.ok(H.Fn("toUpper", 5).Evaluate(H.Ctx()) instanceof NullValue);
    });
    test("unknown function throws CypherSemanticError", () =>
    {
        assert.throws(() => H.Fn("bogus", 1).Evaluate(H.Ctx()), CypherSemanticError);
        assert.throws(() => H.Fn("count", 1).Evaluate(H.Ctx()), CypherSemanticError);
    });
});
