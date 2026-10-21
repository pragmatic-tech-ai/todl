import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ScalarValue, NullValue } from "../values.js";
import { Binding } from "../binding.js";

describe("cypher values + binding", () =>
{
    test("ScalarValue and NullValue project to DTO", () =>
    {
        assert.equal(new ScalarValue("x").ToDto(), "x");
        assert.equal(new ScalarValue(3).ToDto(), 3);
        assert.equal(NullValue.Instance.ToDto(), null);
    });

    test("Binding.With is immutable and overlays", () =>
    {
        const a = new Binding().With("x", new ScalarValue(1));
        const b = a.With("y", new ScalarValue(2));
        assert.equal(a.Get("y"), undefined);
        assert.equal((b.Get("x") as ScalarValue).Value, 1);
        assert.equal((b.Get("y") as ScalarValue).Value, 2);
    });
});
