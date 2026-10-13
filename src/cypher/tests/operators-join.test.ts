import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CartesianProduct } from "../operators-join.js";
import type { IOperator } from "../operators.js";
import { Binding } from "../binding.js";
import { ScalarValue } from "../values.js";

class FixedRows implements IOperator
{
    constructor(private readonly rows: Binding[])
    {
    }

    public *Rows(): Iterable<Binding>
    {
        yield* this.rows;
    }
}

class JoinFixture
{
    public static Row(entries: Record<string, number>): Binding
    {
        let b = new Binding();
        for (const key of Object.keys(entries))
        {
            b = b.With(key, new ScalarValue(entries[key]));
        }
        return b;
    }

    public static Num(row: Binding, variable: string): number
    {
        return (row.Get(variable) as ScalarValue).Value as number;
    }
}

describe("CartesianProduct", () =>
{
    test("disjoint variables yield the cartesian product", () =>
    {
        const left = new FixedRows([JoinFixture.Row({ a: 1 }), JoinFixture.Row({ a: 2 })]);
        const right = new FixedRows([JoinFixture.Row({ b: 10 }), JoinFixture.Row({ b: 20 })]);
        const out = [...new CartesianProduct(left, right).Rows()].map((r) => [JoinFixture.Num(r, "a"), JoinFixture.Num(r, "b")]);
        assert.deepEqual(out, [[1, 10], [1, 20], [2, 10], [2, 20]]);
    });

    test("shared variable joins and drops conflicting pairs", () =>
    {
        const left = new FixedRows([JoinFixture.Row({ a: 1 }), JoinFixture.Row({ a: 2 })]);
        const right = new FixedRows([JoinFixture.Row({ a: 1, b: 9 })]);
        const out = [...new CartesianProduct(left, right).Rows()];
        assert.equal(out.length, 1);
        assert.equal(JoinFixture.Num(out[0], "a"), 1);
        assert.equal(JoinFixture.Num(out[0], "b"), 9);
    });
});
