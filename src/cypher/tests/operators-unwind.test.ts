import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Unwind } from "../operators-unwind.js";
import { SingleRow } from "../operators.js";
import { ScalarValue, NullValue } from "../values.js";
import { ListValue } from "../values-structured.js";
import { ValueLiteral } from "../expressions.js";

class UnwindFixture
{
    public static readonly Variable = "x";

    public static Run(value: ScalarValue | ListValue | NullValue): number[]
    {
        const op = new Unwind(new SingleRow(), new ValueLiteral(value), UnwindFixture.Variable, new Map());
        return [...op.Rows()].map((r) => (r.Get(UnwindFixture.Variable) as ScalarValue).Value as number);
    }
}

describe("Unwind", () =>
{
    test("list yields one row per element", () =>
    {
        assert.deepEqual(UnwindFixture.Run(new ListValue([new ScalarValue(1), new ScalarValue(2)])), [1, 2]);
    });

    test("null yields zero rows", () =>
    {
        assert.equal(UnwindFixture.Run(NullValue.Instance).length, 0);
    });

    test("scalar yields one row", () =>
    {
        assert.deepEqual(UnwindFixture.Run(new ScalarValue(7)), [7]);
    });
});
