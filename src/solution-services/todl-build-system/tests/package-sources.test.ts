import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { CompositePackageSource } from "../composite-package-source.js";
import { CachingPackageSource } from "../caching-package-source.js";
import { SolutionCacheSource } from "../solution-cache-source.js";
import type { IPackageSource, SourcedPackage } from "../package-source.js";
import { PackageKind, type PackageRef } from "../../../publish/publish.js";

function ref(id: string, version = "1.0.0"): PackageRef
{
    return { kind: PackageKind.Library, id, version };
}

function pkg(dependencies: readonly PackageRef[] = []): SourcedPackage
{
    return { Document: { nodes: [], edges: [] }, Dependencies: dependencies };
}

// An in-memory source that counts lookups, for asserting fallback + caching.
class MapPackageSource implements IPackageSource
{
    public Calls = 0;
    private readonly map = new Map<string, SourcedPackage>();

    public Add(id: string, version: string, value: SourcedPackage): void
    {
        this.map.set(`${id}@${version}`, value);
    }

    public TryGet(reference: PackageRef): Promise<SourcedPackage | undefined>
    {
        this.Calls += 1;
        return Promise.resolve(this.map.get(`${reference.id}@${reference.version}`));
    }
}

describe("CompositePackageSource", () =>
{
    test("returns the first source that has the package", async () =>
    {
        const first = new MapPackageSource();
        const second = new MapPackageSource();
        second.Add("shop", "1.0.0", pkg());
        const composite = new CompositePackageSource([first, second]);

        const found = await composite.TryGet(ref("shop"));

        assert.notEqual(found, undefined);
        assert.equal(second.Calls, 1);
    });

    test("prefers an earlier source over a later one", async () =>
    {
        const first = new MapPackageSource();
        const second = new MapPackageSource();
        const winner = pkg([ref("dep")]);
        first.Add("shop", "1.0.0", winner);
        second.Add("shop", "1.0.0", pkg());
        const composite = new CompositePackageSource([first, second]);

        const found = await composite.TryGet(ref("shop"));

        assert.equal(found, winner);
        assert.equal(second.Calls, 0); // short-circuited on the first hit
    });

    test("returns undefined when no source has it", async () =>
    {
        const composite = new CompositePackageSource([new MapPackageSource()]);
        assert.equal(await composite.TryGet(ref("missing")), undefined);
    });
});

describe("SolutionCacheSource", () =>
{
    test("Put then TryGet round-trips the document and dependencies", async () =>
    {
        const cache = new SolutionCacheSource(new FakeStorage());
        const stored = pkg([ref("base", "2.0.0")]);
        await cache.Put(ref("shop"), stored);

        const loaded = await cache.TryGet(ref("shop"));

        assert.deepEqual(loaded?.Document, { nodes: [], edges: [] });
        assert.deepEqual(loaded?.Dependencies, [ref("base", "2.0.0")]);
    });

    test("TryGet returns undefined for an uncached package", async () =>
    {
        const cache = new SolutionCacheSource(new FakeStorage());
        assert.equal(await cache.TryGet(ref("absent")), undefined);
    });
});

describe("CachingPackageSource", () =>
{
    test("misses the cache, fetches upstream once, then serves from cache", async () =>
    {
        const upstream = new MapPackageSource();
        upstream.Add("shop", "1.0.0", pkg());
        const cache = new SolutionCacheSource(new FakeStorage());
        const caching = new CachingPackageSource(cache, upstream);

        const first = await caching.TryGet(ref("shop"));
        const second = await caching.TryGet(ref("shop"));

        assert.notEqual(first, undefined);
        assert.notEqual(second, undefined);
        assert.equal(upstream.Calls, 1); // second call served from the cache
        assert.notEqual(await cache.TryGet(ref("shop")), undefined); // written through
    });

    test("returns undefined when neither cache nor upstream has it", async () =>
    {
        const caching = new CachingPackageSource(new SolutionCacheSource(new FakeStorage()), new MapPackageSource());
        assert.equal(await caching.TryGet(ref("nope")), undefined);
    });
});
