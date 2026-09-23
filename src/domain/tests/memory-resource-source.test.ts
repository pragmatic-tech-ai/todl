import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryResourceSource } from "../memory-resource-source.js";

test("resource returns content for a known uri with inferred mime", async () =>
{
    const src = new MemoryResourceSource();
    src.Add("acme/1.0.0/resources/a.svg", new Uint8Array([1, 2, 3]));
    const got = await src.resource("acme/1.0.0/resources/a.svg");
    assert.deepEqual(got, { uri: "acme/1.0.0/resources/a.svg", mime: "image/svg+xml", bytes: new Uint8Array([1, 2, 3]) });
});

test("resource returns undefined for an unknown uri", async () =>
{
    const src = new MemoryResourceSource();
    assert.equal(await src.resource("missing"), undefined);
});

test("ctor-seeded entries resolve", async () =>
{
    const src = new MemoryResourceSource([["p/1.0.0/x.png", new Uint8Array([9])]]);
    assert.equal((await src.resource("p/1.0.0/x.png"))!.mime, "image/png");
});
