import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CypherValue, ScalarValue, NullValue } from "../values.js";

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
});
