import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ArithmeticExpression, UnaryMinus, Literal, ListLiteral, MapLiteral, IndexAccess, PropertyAccess, VariableRef } from "../expressions.js";
import { ArithmeticOp } from "../enums.js";
import { Binding, EvalContext } from "../binding.js";
import { ScalarValue, NullValue } from "../values.js";
import { ListValue, MapValue } from "../values-structured.js";

class H
{
    public static Ctx(): EvalContext
    {
        return new EvalContext(new Binding(), new Map());
    }

    public static Num(op: ArithmeticOp, l: number, r: number): unknown
    {
        const v = new ArithmeticExpression(new Literal(l), op, new Literal(r)).Evaluate(H.Ctx());
        return v instanceof ScalarValue ? v.Value : v;
    }
}

describe("sp2 expressions", () =>
{
    test("arithmetic + string concat", () =>
    {
        assert.equal((new ArithmeticExpression(new Literal(2), ArithmeticOp.Add, new Literal(3)).Evaluate(H.Ctx()) as ScalarValue).Value, 5);
        assert.equal((new ArithmeticExpression(new Literal("a"), ArithmeticOp.Add, new Literal("b")).Evaluate(H.Ctx()) as ScalarValue).Value, "ab");
    });

    test("all numeric ops", () =>
    {
        assert.equal(H.Num(ArithmeticOp.Sub, 5, 3), 2);
        assert.equal(H.Num(ArithmeticOp.Mul, 4, 3), 12);
        assert.equal(H.Num(ArithmeticOp.Div, 6, 3), 2);
        assert.equal(H.Num(ArithmeticOp.Mod, 7, 3), 1);
    });

    test("divide by zero and mixed-type → null, never throws", () =>
    {
        assert.ok(new ArithmeticExpression(new Literal(1), ArithmeticOp.Div, new Literal(0)).Evaluate(H.Ctx()) instanceof NullValue);
        assert.ok(new ArithmeticExpression(new Literal(1), ArithmeticOp.Mod, new Literal(0)).Evaluate(H.Ctx()) instanceof NullValue);
        assert.ok(new ArithmeticExpression(new Literal("a"), ArithmeticOp.Add, new Literal(1)).Evaluate(H.Ctx()) instanceof NullValue);
        assert.ok(new ArithmeticExpression(new Literal("a"), ArithmeticOp.Sub, new Literal("b")).Evaluate(H.Ctx()) instanceof NullValue);
        assert.ok(new ArithmeticExpression(new Literal(null), ArithmeticOp.Add, new Literal(1)).Evaluate(H.Ctx()) instanceof NullValue);
    });

    test("unary minus", () =>
    {
        assert.equal((new UnaryMinus(new Literal(5)).Evaluate(H.Ctx()) as ScalarValue).Value, -5);
        assert.ok(new UnaryMinus(new Literal("x")).Evaluate(H.Ctx()) instanceof NullValue);
    });

    test("list/map literals + index access", () =>
    {
        const list = new ListLiteral([new Literal(10), new Literal(20)]);
        assert.ok(list.Evaluate(H.Ctx()) instanceof ListValue);
        assert.equal((new IndexAccess(list, new Literal(1)).Evaluate(H.Ctx()) as ScalarValue).Value, 20);
        assert.ok(new IndexAccess(list, new Literal(5)).Evaluate(H.Ctx()) instanceof NullValue);
        assert.ok(new IndexAccess(list, new Literal(-1)).Evaluate(H.Ctx()) instanceof NullValue);
        assert.ok(new IndexAccess(list, new Literal(0.5)).Evaluate(H.Ctx()) instanceof NullValue);
        assert.ok(new IndexAccess(list, new Literal("k")).Evaluate(H.Ctx()) instanceof NullValue);
        const map = new MapLiteral(new Map([["k", new Literal(7)]]));
        assert.ok(map.Evaluate(H.Ctx()) instanceof MapValue);
        assert.equal((new IndexAccess(map, new Literal("k")).Evaluate(H.Ctx()) as ScalarValue).Value, 7);
        assert.ok(new IndexAccess(map, new Literal("z")).Evaluate(H.Ctx()) instanceof NullValue);
        assert.ok(new IndexAccess(new Literal(1), new Literal(0)).Evaluate(H.Ctx()) instanceof NullValue);
    });

    test("PropertyAccess on bound map; CollectVariables recurses", () =>
    {
        const b = new Binding();
        const bound = b.With("m", new MapValue(new Map([["a", new ScalarValue(9)]])));
        const ctx = new EvalContext(bound, new Map());
        assert.equal((new PropertyAccess("m", "a").Evaluate(ctx) as ScalarValue).Value, 9);
        assert.ok(new PropertyAccess("m", "nope").Evaluate(ctx) instanceof NullValue);

        const into = new Set<string>();
        new IndexAccess(
            new ListLiteral([new ArithmeticExpression(new VariableRef("x"), ArithmeticOp.Add, new UnaryMinus(new VariableRef("y")))]),
            new MapLiteral(new Map([["k", new VariableRef("z")]]))).CollectVariables(into);
        assert.deepEqual([...into].sort(), ["x", "y", "z"]);
    });
});
