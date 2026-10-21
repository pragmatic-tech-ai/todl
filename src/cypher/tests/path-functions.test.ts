import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FunctionCall, ValueLiteral } from "../expressions.js";
import { Binding, EvalContext } from "../binding.js";
import { ScalarValue, NullValue } from "../values.js";
import { ListValue, RelValue, PathValue } from "../values-structured.js";

class PathFunctionsFixture
{
    public static Ctx(): EvalContext
    {
        return new EvalContext(new Binding(), new Map());
    }

    public static Call(name: string, arg: ValueLiteral): FunctionCall
    {
        return new FunctionCall(name, [arg], false, false);
    }

    public static Path(): PathValue
    {
        return new PathValue([], [new RelValue("a", "calls", "b")]);
    }
}

describe("path functions", () =>
{
    test("length + relationships", () =>
    {
        const lit = new ValueLiteral(PathFunctionsFixture.Path());
        const ctx = PathFunctionsFixture.Ctx();
        assert.equal((PathFunctionsFixture.Call("length", lit).Evaluate(ctx) as ScalarValue).Value, 1);
        const rels = PathFunctionsFixture.Call("relationships", lit).Evaluate(ctx);
        assert.ok(rels instanceof ListValue);
        assert.equal(rels.Items.length, 1);
        assert.ok(rels.Items[0] instanceof RelValue);
    });

    test("nodes returns a list", () =>
    {
        const lit = new ValueLiteral(PathFunctionsFixture.Path());
        const nodes = PathFunctionsFixture.Call("nodes", lit).Evaluate(PathFunctionsFixture.Ctx());
        assert.ok(nodes instanceof ListValue);
        assert.equal(nodes.Items.length, 0);
    });

    test("non-path argument yields null", () =>
    {
        const lit = new ValueLiteral(new ScalarValue(5));
        const ctx = PathFunctionsFixture.Ctx();
        for (const name of ["length", "nodes", "relationships"])
        {
            assert.ok(PathFunctionsFixture.Call(name, lit).Evaluate(ctx) instanceof NullValue);
        }
    });
});
