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

    test("every match row is emitted; no padding when any row matched", () =>
    {
        const plan: IOptionalPlan = {
            Build: (row) => new RowSource([row.With("b", new ScalarValue(1)), row.With("b", new ScalarValue(2)), row.With("b", new ScalarValue(3))]),
        };
        const inputs = new RowSource([new Binding().With("a", new ScalarValue(1)), new Binding().With("a", new ScalarValue(2))]);
        const out = [...new OptionalApply(inputs, plan, ["b"]).Rows()];
        assert.deepEqual(out.map((r) => [(r.Get("a") as ScalarValue).Value, (r.Get("b") as ScalarValue).Value]), [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3]]);
    });

    test("all optional variables are nulled when nothing matches; input bindings preserved", () =>
    {
        const plan: IOptionalPlan = { Build: () => new RowSource([]) };
        const inputs = new RowSource([new Binding().With("a", new ScalarValue(5))]);
        const out = [...new OptionalApply(inputs, plan, ["b", "c", "d"]).Rows()];
        assert.equal(out.length, 1);
        assert.equal((out[0]!.Get("a") as ScalarValue).Value, 5);
        for (const v of ["b", "c", "d"])
        {
            assert.ok(out[0]!.Get(v) instanceof NullValue, v);
        }
    });
});
