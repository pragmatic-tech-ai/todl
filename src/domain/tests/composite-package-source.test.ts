import { test } from "node:test";
import assert from "node:assert/strict";
import { CompositePackageSource } from "../composite-package-source.js";
import { MemoryPackageSource } from "../memory-package-source.js";
import { MemoryResourceSource } from "../memory-resource-source.js";
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

test("resource delegates to a member ResourceSource", async () =>
{
    const res = new MemoryResourceSource([["m/1.0.0/a.svg", new Uint8Array([1])]]);
    const composite = new CompositePackageSource([new MemoryPackageSource(), res]);
    assert.deepEqual((await composite.resource("m/1.0.0/a.svg"))!.bytes, new Uint8Array([1]));
});

test("resource returns the first non-undefined across members", async () =>
{
    const first = new MemoryResourceSource([["m/1.0.0/a.svg", new Uint8Array([1])]]);
    const second = new MemoryResourceSource([["m/1.0.0/a.svg", new Uint8Array([2])]]);
    const composite = new CompositePackageSource([first, second]);
    assert.deepEqual((await composite.resource("m/1.0.0/a.svg"))!.bytes, new Uint8Array([1]));
});

test("resource skips members without the capability and misses cleanly", async () =>
{
    const composite = new CompositePackageSource([new MemoryPackageSource(), new MemoryPackageSource()]);
    assert.equal(await composite.resource("m/1.0.0/none.svg"), undefined);
});
