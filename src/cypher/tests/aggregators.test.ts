import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AggregatorFactory } from "../aggregators.js";
import { ScalarValue, NullValue, type CypherValue } from "../values.js";
import { CypherSemanticError } from "../errors.js";
import { ListValue } from "../values-structured.js";

class AggHarness
{
    public static Run(name: string, star: boolean, vals: (number | null)[]): CypherValue
    {
        const agg = AggregatorFactory.Create(name, star);
        for (const v of vals)
        {
            agg.Accept(v === null ? NullValue.Instance : new ScalarValue(v));
        }
        return agg.Result();
    }

    public static Num(name: string, star: boolean, vals: (number | null)[]): unknown
    {
        return (AggHarness.Run(name, star, vals) as ScalarValue).Value;
    }
}

describe("aggregators", () =>
{
    test("count skips null; count(*) counts rows", () =>
    {
        assert.equal(AggHarness.Num("count", false, [1, null, 3]), 2);
        assert.equal(AggHarness.Num("count", true, [1, null, 3]), 3);
    });
    test("sum/avg/min/max skip null", () =>
    {
        assert.equal(AggHarness.Num("sum", false, [1, 2, null, 3]), 6);
        assert.equal(AggHarness.Num("avg", false, [2, 4]), 3);
        assert.equal(AggHarness.Num("min", false, [3, 1, 2]), 1);
        assert.equal(AggHarness.Num("max", false, [1, null, 5, 3]), 5);
        assert.equal(AggHarness.Num("min", false, [null, 4, 2]), 2);
        assert.equal(AggHarness.Num("avg", false, [2, null, 4]), 3);
    });
    test("empty input yields null for avg/min/max and 0 for sum", () =>
    {
        assert.equal(AggHarness.Num("sum", false, [null]), 0);
        assert.ok(AggHarness.Run("avg", false, []) instanceof NullValue);
        assert.ok(AggHarness.Run("avg", false, [null, null]) instanceof NullValue);
        assert.ok(AggHarness.Run("min", false, [null]) instanceof NullValue);
        assert.ok(AggHarness.Run("max", false, []) instanceof NullValue);
    });
    test("collect gathers non-null into a list", () =>
    {
        const r = AggHarness.Run("collect", false, [1, null, 2]);
        assert.ok(r instanceof ListValue);
        assert.deepEqual(r.Items.map(i => (i as ScalarValue).Value), [1, 2]);
        for (const vals of [[], [null, null]])
        {
            const e = AggHarness.Run("collect", false, vals);
            assert.ok(e instanceof ListValue && e.Items.length === 0);
        }
    });
    test("unknown aggregator throws", () =>
    {
        assert.throws(() => AggregatorFactory.Create("bogus", false), CypherSemanticError);
    });
    test("names are case-insensitive", () =>
    {
        assert.equal(AggHarness.Num("COUNT", true, [1, null]), 2);
    });
});
