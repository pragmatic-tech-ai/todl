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

    test("Put then TryGet round-trips resource bytes", async () =>
    {
        const cache = new SolutionCacheSource(new FakeStorage());
        const stored: SourcedPackage = { Document: { nodes: [], edges: [] }, Dependencies: [],
            resources: [{ path: "resources/a.svg", bytes: new Uint8Array([1, 2, 3]) }] };
        await cache.Put(ref("shop"), stored);

        const loaded = await cache.TryGet(ref("shop"));
        assert.equal(loaded?.resources?.length, 1);
        assert.equal(loaded?.resources?.[0]?.path, "resources/a.svg");
        assert.deepEqual(Uint8Array.from(loaded!.resources![0]!.bytes), new Uint8Array([1, 2, 3]));
    });

    test("TryGet omits resources when only model.json + src are stored", async () =>
    {
        const storage = new FakeStorage();
        const cache = new SolutionCacheSource(storage);
        await cache.Put(ref("shop"), pkg());
        await storage.WriteText("shop/1.0.0/src/shop.todl", "namespace acme {}"); // a source must NOT surface

        const loaded = await cache.TryGet(ref("shop"));
        assert.equal(loaded?.resources, undefined);
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

    test("writes upstream resource bytes through to the cache", async () =>
    {
        const upstream = new MapPackageSource();
        upstream.Add("shop", "1.0.0", { Document: { nodes: [], edges: [] }, Dependencies: [],
            resources: [{ path: "resources/b.png", bytes: new Uint8Array([9]) }] });
        const cache = new SolutionCacheSource(new FakeStorage());
        const caching = new CachingPackageSource(cache, upstream);

        await caching.TryGet(ref("shop"));
        const cached = await cache.TryGet(ref("shop"));
        assert.deepEqual(Uint8Array.from(cached!.resources![0]!.bytes), new Uint8Array([9]));
    });
});
