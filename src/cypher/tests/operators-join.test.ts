import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CartesianProduct } from "../operators-join.js";
import { SingleRow } from "../operators.js";
import { ListValue } from "../values-structured.js";
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

    test("multi-row cross product preserves input bindings on both sides", () =>
    {
        const left = new FixedRows([JoinFixture.Row({ a: 1, p: 7 }), JoinFixture.Row({ a: 2, p: 8 }), JoinFixture.Row({ a: 3, p: 9 })]);
        const right = new FixedRows([JoinFixture.Row({ b: 10, q: 5 }), JoinFixture.Row({ b: 20, q: 6 })]);
        const out = [...new CartesianProduct(left, right).Rows()];
        assert.equal(out.length, 6);
        assert.deepEqual(out.map((r) => [JoinFixture.Num(r, "a"), JoinFixture.Num(r, "p"), JoinFixture.Num(r, "b"), JoinFixture.Num(r, "q")]), [
            [1, 7, 10, 5], [1, 7, 20, 6], [2, 8, 10, 5], [2, 8, 20, 6], [3, 9, 10, 5], [3, 9, 20, 6],
        ]);
    });

    test("an empty side yields no rows", () =>
    {
        const some = new FixedRows([JoinFixture.Row({ a: 1 })]);
        assert.equal([...new CartesianProduct(some, new FixedRows([])).Rows()].length, 0);
        assert.equal([...new CartesianProduct(new FixedRows([]), some).Rows()].length, 0);
    });

    test("SingleRow joined with a source returns that source unchanged", () =>
    {
        assert.equal([...new SingleRow().Rows()].length, 1);
        const right = new FixedRows([JoinFixture.Row({ b: 1 }), JoinFixture.Row({ b: 2 })]);
        const out = [...new CartesianProduct(new SingleRow(), right).Rows()];
        assert.deepEqual(out.map((r) => JoinFixture.Num(r, "b")), [1, 2]);
    });

    test("shared non-scalar variable joins by structural identity", () =>
    {
        const list = (...v: number[]) => new ListValue(v.map((x) => new ScalarValue(x)));
        const left = new FixedRows([new Binding().With("l", list(1, 2)).With("a", new ScalarValue(1)), new Binding().With("l", list(3)).With("a", new ScalarValue(2))]);
        const right = new FixedRows([new Binding().With("l", list(1, 2)).With("b", new ScalarValue(9)), new Binding().With("l", list(1)).With("b", new ScalarValue(8))]);
        const out = [...new CartesianProduct(left, right).Rows()];
        assert.equal(out.length, 1);
        assert.equal(JoinFixture.Num(out[0]!, "a"), 1);
        assert.equal(JoinFixture.Num(out[0]!, "b"), 9);
    });
});
