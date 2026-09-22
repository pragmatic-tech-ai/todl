import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryPackageSource } from "../memory-package-source.js";
import type { ResolvedPackage } from "../domain.js";

function pkg(model: string, version: string): ResolvedPackage
{
    return { ref: { model, version }, manifest: { model, version, types: [], terms: [], taxonomies: [] } as never, dependencies: [] };
}

test("resolve returns the package for a known ref", async () =>
{
    const src = new MemoryPackageSource([pkg("acme.a", "1.0.0")]);
    const r = await src.resolve({ model: "acme.a", version: "1.0.0" });
    assert.equal(r.ref.model, "acme.a");
});

test("resolve throws for an unknown ref", async () =>
{
    const src = new MemoryPackageSource();
    await assert.rejects(src.resolve({ model: "acme.x", version: "1.0.0" }), /acme\.x@1\.0\.0/);
});

test("versions lists the present versions of a model", async () =>
{
    const src = new MemoryPackageSource([pkg("acme.a", "1.0.0"), pkg("acme.a", "1.2.0")]);
    assert.deepEqual([...(await src.versions("acme.a"))].sort(), ["1.0.0", "1.2.0"]);
    assert.deepEqual(await src.versions("acme.b"), []);
});
