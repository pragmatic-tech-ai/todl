import { test } from "node:test";
import assert from "node:assert/strict";
import { Deadline } from "../execution-limits.js";

test("Deadline.After expires only once the budget elapses", async () =>
{
    const d = Deadline.After(20);
    assert.equal(d.Expired(), false);
    await new Promise((r) => setTimeout(r, 35));
    assert.equal(d.Expired(), true);
});
