import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ScalarValue, NullValue } from "../values.js";
import { ListValue, MapValue, RelValue, PathValue } from "../values-structured.js";

describe("structured values", () =>
{
    test("ListValue ToDto + GroupKey", () =>
    {
        const l = new ListValue([new ScalarValue(1), new ScalarValue("x")]);
        assert.deepEqual(l.ToDto(), [1, "x"]);
        assert.equal(l.GroupKey(), new ListValue([new ScalarValue(1), new ScalarValue("x")]).GroupKey());
        assert.notEqual(l.GroupKey(), new ListValue([new ScalarValue(1)]).GroupKey());
    });

    test("MapValue Get + ToDto", () =>
    {
        const m = new MapValue(new Map([["a", new ScalarValue(1)], ["b", NullValue.Instance]]));
        assert.equal((m.Get("a") as ScalarValue).Value, 1);
        assert.deepEqual(m.ToDto(), { a: 1, b: null });
    });

    test("RelValue + PathValue", () =>
    {
        const rel = new RelValue("a", "calls", "b");
        assert.deepEqual(rel.ToDto(), { from: "a", type: "calls", to: "b" });
        // PathValue length uses rels count (node stand-ins built in integration tests)
        const p = new PathValue([], [rel]); // shape-only; real nodes exercised in integration
        assert.equal(p.Length(), 1);
    });
});
