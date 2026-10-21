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

class MultiRows
{
    public static Make(pairs: number[][]): Binding[]
    {
        return pairs.map((p) => new Binding().With("x", new ScalarValue(p[0]!)).With("y", new ScalarValue(p[1]!)));
    }

    public static Pairs(rows: Iterable<Binding>): number[][]
    {
        return [...rows].map((r) => [(r.Get("x") as ScalarValue).Value as number, (r.Get("y") as ScalarValue).Value as number]);
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

    test("Distinct keeps rows whose column keys differ only by the separator character", () =>
    {
        const sep = String.fromCharCode(0);
        const row1 = new Binding().With("x", new ScalarValue("a" + sep + "string:b")).With("y", new ScalarValue("c"));
        const row2 = new Binding().With("x", new ScalarValue("a")).With("y", new ScalarValue("b" + sep + "string:c"));
        const out = [...new Distinct(new Rows([row1, row2]), ["x", "y"]).Rows()];
        assert.equal(out.length, 2);
    });

    test("Skip(0) skips nothing; negative and NaN clamp to zero", () =>
    {
        assert.deepEqual(Rows.Values(new Skip(Rows.Of("x", [1, 2, 3]), 0).Rows()), [1, 2, 3]);
        assert.deepEqual(Rows.Values(new Skip(Rows.Of("x", [1, 2, 3]), -5).Rows()), [1, 2, 3]);
        assert.deepEqual(Rows.Values(new Skip(Rows.Of("x", [1, 2, 3]), Number.NaN).Rows()), [1, 2, 3]);
        assert.deepEqual(Rows.Values(new Skip(Rows.Of("x", [1, 2, 3]), 1.9).Rows()), [2, 3]);
    });

    test("multi-key sort: later key breaks ties, per-key direction", () =>
    {
        const src = new Rows(MultiRows.Make([[1, 2], [2, 1], [1, 1], [2, 2]]));
        const mixed = new Sort(src, [new SortItem(new VariableRef("x"), false), new SortItem(new VariableRef("y"), true)], new Map());
        assert.deepEqual(MultiRows.Pairs(mixed.Rows()), [[1, 2], [1, 1], [2, 2], [2, 1]]);
    });

    test("sort is stable: tied keys keep input order", () =>
    {
        const src = new Rows(MultiRows.Make([[1, 10], [0, 11], [1, 12], [0, 13], [1, 14]]));
        const out = new Sort(src, [new SortItem(new VariableRef("x"), false)], new Map());
        assert.deepEqual(MultiRows.Pairs(out.Rows()), [[0, 11], [0, 13], [1, 10], [1, 12], [1, 14]]);
        const desc = new Sort(new Rows(MultiRows.Make([[1, 10], [0, 11], [1, 12], [0, 13], [1, 14]])), [new SortItem(new VariableRef("x"), true)], new Map());
        assert.deepEqual(MultiRows.Pairs(desc.Rows()), [[1, 10], [1, 12], [1, 14], [0, 11], [0, 13]]);
    });

    test("Limit(0) yields nothing; a large limit yields everything", () =>
    {
        assert.deepEqual(Rows.Values(new Limit(Rows.Of("x", [1, 2, 3]), 0).Rows()), []);
        assert.deepEqual(Rows.Values(new Limit(Rows.Of("x", [1, 2, 3]), 10).Rows()), [1, 2, 3]);
    });

    test("Skip beyond the end yields nothing", () =>
    {
        assert.deepEqual(Rows.Values(new Skip(Rows.Of("x", [1, 2, 3]), 3).Rows()), []);
        assert.deepEqual(Rows.Values(new Skip(Rows.Of("x", [1, 2, 3]), 99).Rows()), []);
    });

    test("multi-column Distinct dedups on the column tuple", () =>
    {
        const src = new Rows(MultiRows.Make([[1, 1], [1, 2], [1, 1], [2, 1], [2, 1], [1, 2]]));
        assert.deepEqual(MultiRows.Pairs(new Distinct(src, ["x", "y"]).Rows()), [[1, 1], [1, 2], [2, 1]]);
        assert.deepEqual(MultiRows.Pairs(new Distinct(new Rows(MultiRows.Make([[1, 1], [1, 2], [2, 3]])), ["x"]).Rows()), [[1, 1], [2, 3]]);
    });
});
