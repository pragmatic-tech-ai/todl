import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { IOptionalPlan } from "../operators-optional.js";
import { OptionalApply } from "../operators-optional.js";
import type { IOperator } from "../operators.js";
import { Binding } from "../binding.js";
import { ScalarValue, NullValue } from "../values.js";

class RowSource implements IOperator
{
    constructor(private readonly rows: Binding[])
    {
    }

    public *Rows(): Iterable<Binding>
    {
        yield* this.rows;
    }
}

class OptionalFixture implements IOptionalPlan
{
    public static readonly A = "a";
    public static readonly B = "b";

    public Build(row: Binding): IOperator
    {
        const a = (row.Get(OptionalFixture.A) as ScalarValue).Value;
        return a === 1 ? new RowSource([row.With(OptionalFixture.B, new ScalarValue(10))]) : new RowSource([]);
    }
}

describe("OptionalApply", () =>
{
    test("passes matches; nulls the optional vars when none", () =>
    {
        const inputs = new RowSource([
            new Binding().With(OptionalFixture.A, new ScalarValue(1)),
            new Binding().With(OptionalFixture.A, new ScalarValue(2)),
        ]);
        const out = [...new OptionalApply(inputs, new OptionalFixture(), [OptionalFixture.B]).Rows()];
        assert.equal(out.length, 2);
        assert.equal((out[0]!.Get(OptionalFixture.B) as ScalarValue).Value, 10);
        assert.ok(out[1]!.Get(OptionalFixture.B) instanceof NullValue);
        assert.equal((out[1]!.Get(OptionalFixture.A) as ScalarValue).Value, 2);
    });
});
