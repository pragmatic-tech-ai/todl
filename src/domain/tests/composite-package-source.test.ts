import { test } from "node:test";
import assert from "node:assert/strict";
import { CompositePackageSource } from "../composite-package-source.js";
import { MemoryPackageSource } from "../memory-package-source.js";
import type { ResolvedPackage } from "../domain.js";

function pkg(model: string, version: string): ResolvedPackage
{
    return { ref: { model, version }, manifest: {} as never, dependencies: [] };
}

test("resolve returns from the first source that has the ref", async () =>
{
    const a = new MemoryPackageSource([pkg("acme.a", "1.0.0")]);
    const b = new MemoryPackageSource([pkg("acme.b", "1.0.0")]);
    const composite = new CompositePackageSource([a, b]);
    assert.equal((await composite.resolve({ model: "acme.b", version: "1.0.0" })).ref.model, "acme.b");
});

test("resolve falls through a source that throws", async () =>
{
    const empty = new MemoryPackageSource();
    const has = new MemoryPackageSource([pkg("acme.a", "1.0.0")]);
    const composite = new CompositePackageSource([empty, has]);
    assert.equal((await composite.resolve({ model: "acme.a", version: "1.0.0" })).ref.version, "1.0.0");
});

test("resolve throws naming the ref when every source misses", async () =>
{
    const composite = new CompositePackageSource([new MemoryPackageSource(), new MemoryPackageSource()]);
    await assert.rejects(composite.resolve({ model: "acme.x", version: "9.9.9" }), /acme\.x@9\.9\.9/);
});

test("versions unions across sources, de-duped", async () =>
{
    const a = new MemoryPackageSource([pkg("acme.a", "1.0.0")]);
    const b = new MemoryPackageSource([pkg("acme.a", "1.0.0"), pkg("acme.a", "2.0.0")]);
    const composite = new CompositePackageSource([a, b]);
    assert.deepEqual([...(await composite.versions("acme.a"))].sort(), ["1.0.0", "2.0.0"]);
});
