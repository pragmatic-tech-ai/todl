import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Sort, Skip, Limit, Distinct } from "../operators-ordering.js";
import type { IOperator } from "../operators.js";
import { Binding } from "../binding.js";
import { ScalarValue } from "../values.js";
import { SortItem } from "../query-model.js";
import { VariableRef } from "../expressions.js";

class Rows implements IOperator
{
    constructor(private readonly rows: Binding[])
    {
    }

    public *Rows(): Iterable<Binding>
    {
        yield* this.rows;
    }

    public static Of(col: string, vals: number[]): Rows
    {
        return new Rows(vals.map((v) => new Binding().With(col, new ScalarValue(v))));
    }

    public static Values(rows: Iterable<Binding>): unknown[]
    {
        return [...rows].map((r) => (r.Get("x") as ScalarValue).Value);
    }
}

describe("ordering operators", () =>
{
    test("Sort asc + desc", () =>
    {
        const asc = new Sort(Rows.Of("x", [3, 1, 2]), [new SortItem(new VariableRef("x"), false)], new Map());
        assert.deepEqual(Rows.Values(asc.Rows()), [1, 2, 3]);
        const desc = new Sort(Rows.Of("x", [3, 1, 2]), [new SortItem(new VariableRef("x"), true)], new Map());
        assert.deepEqual(Rows.Values(desc.Rows()), [3, 2, 1]);
    });

    test("Skip + Limit window", () =>
    {
        const op = new Limit(new Skip(Rows.Of("x", [0, 1, 2, 3, 4]), 1), 2);
        assert.deepEqual(Rows.Values(op.Rows()), [1, 2]);
    });

    test("Distinct dedups by column key", () =>
    {
        const op = new Distinct(Rows.Of("x", [1, 1, 2, 2, 2, 3]), ["x"]);
        assert.deepEqual(Rows.Values(op.Rows()), [1, 2, 3]);
    });
});
