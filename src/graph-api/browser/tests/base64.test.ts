import { test } from "node:test";
import assert from "node:assert/strict";
import { Base64 } from "../base64.js";

test("Base64 round-trips arbitrary bytes", () =>
{
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    assert.deepEqual(Base64.Decode(Base64.Encode(bytes)), bytes);
});

test("Base64.Encode matches a known vector", () =>
{
    assert.equal(Base64.Encode(new Uint8Array([104, 105])), "aGk="); // "hi"
});
