import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CypherValue, ScalarValue, NullValue } from "../values.js";
import { ListValue, MapValue, RelValue, PathValue } from "../values-structured.js";

describe("CypherValue GroupKey + Compare", () =>
{
    test("GroupKey distinguishes scalars, null, and by-type", () =>
    {
        assert.notEqual(new ScalarValue(1).GroupKey(), new ScalarValue("1").GroupKey());
        assert.equal(new ScalarValue(1).GroupKey(), new ScalarValue(1).GroupKey());
        assert.equal(NullValue.Instance.GroupKey(), NullValue.Instance.GroupKey());
    });

    test("Compare orders numbers, then nulls last (ascending)", () =>
    {
        assert.ok(CypherValue.Compare(new ScalarValue(1), new ScalarValue(2)) < 0);
        assert.ok(CypherValue.Compare(new ScalarValue(2), new ScalarValue(1)) > 0);
        assert.equal(CypherValue.Compare(new ScalarValue(2), new ScalarValue(2)), 0);
        assert.ok(CypherValue.Compare(new ScalarValue(2), NullValue.Instance) < 0);
        assert.ok(CypherValue.Compare(NullValue.Instance, new ScalarValue(2)) > 0);
    });

    test("Compare orders strings lexically", () =>
    {
        assert.ok(CypherValue.Compare(new ScalarValue("a"), new ScalarValue("b")) < 0);
    });

    test("cross-type order: number < string < boolean < list < map < rel < path < null", () =>
    {
        const ordered: CypherValue[] = [
            new ScalarValue(1e9), new ScalarValue("a"), new ScalarValue(false), new ScalarValue(true),
            new ListValue([]), new MapValue(new Map()),
            new RelValue("a", "t", "b"), new PathValue([], []), NullValue.Instance,
        ];
        for (let i = 0; i < ordered.length; i++)
        {
            for (let j = 0; j < ordered.length; j++)
            {
                const c = CypherValue.Compare(ordered[i]!, ordered[j]!);
                assert.equal(Math.sign(c), Math.sign(i - j), `${i} vs ${j}`);
            }
        }
    });

    test("ListValue compares element-wise, then by length", () =>
    {
        const l = (...v: number[]) => new ListValue(v.map((x) => new ScalarValue(x)));
        assert.ok(CypherValue.Compare(l(1, 2), l(1, 3)) < 0);
        assert.ok(CypherValue.Compare(l(2), l(1, 9)) > 0);
        assert.ok(CypherValue.Compare(l(1), l(1, 0)) < 0);
        assert.ok(CypherValue.Compare(l(1, 0), l(1)) > 0);
        assert.equal(CypherValue.Compare(l(1, 2), l(1, 2)), 0);
    });

    test("MapValue compares by sorted keys, then values, then size", () =>
    {
        const m = (o: Record<string, number>) => new MapValue(new Map(Object.keys(o).map((k) => [k, new ScalarValue(o[k]!)] as [string, CypherValue])));
        assert.ok(CypherValue.Compare(m({ a: 1 }), m({ b: 1 })) < 0);
        assert.ok(CypherValue.Compare(m({ a: 1 }), m({ a: 2 })) < 0);
        assert.ok(CypherValue.Compare(m({ a: 1 }), m({ a: 1, b: 0 })) < 0);
        assert.equal(CypherValue.Compare(m({ a: 1, b: 2 }), m({ b: 2, a: 1 })), 0);
    });

    test("RelValue and PathValue compare totally and deterministically", () =>
    {
        const r1 = new RelValue("a", "t", "b");
        const r2 = new RelValue("a", "t", "c");
        assert.ok(CypherValue.Compare(r1, r2) < 0);
        assert.ok(CypherValue.Compare(r2, r1) > 0);
        assert.equal(CypherValue.Compare(r1, new RelValue("a", "t", "b")), 0);
        const p1 = new PathValue([], [r1]);
        const p2 = new PathValue([], [r2]);
        assert.ok(CypherValue.Compare(p1, p2) < 0);
        assert.ok(CypherValue.Compare(p2, p1) > 0);
        assert.equal(CypherValue.Compare(p1, new PathValue([], [r1])), 0);
    });
});
