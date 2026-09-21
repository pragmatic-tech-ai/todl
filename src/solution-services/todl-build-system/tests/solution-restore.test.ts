import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { PackageKind, type PackageRef } from "../../../publish/publish.js";
import type { IPackageSource, SourcedPackage } from "../package-source.js";
import { CachingPackageSource } from "../caching-package-source.js";
import { SolutionCacheSource } from "../solution-cache-source.js";
import { SolutionRestore } from "../solution-restore.js";

function ref(id: string, version = "1.0.0"): PackageRef
{
    return { kind: PackageKind.Library, id, version };
}

function pkg(deps: readonly PackageRef[]): SourcedPackage
{
    return { Document: { nodes: [], edges: [] }, Dependencies: deps };
}

// An upstream that serves a fixed graph and counts fetches, to prove restore both walks
// the transitive closure and de-duplicates a diamond.
class CountingUpstream implements IPackageSource
{
    public Fetches = 0;
    constructor(private readonly graph: ReadonlyMap<string, SourcedPackage>) {}

    public TryGet(reference: PackageRef): Promise<SourcedPackage | undefined>
    {
        this.Fetches++;
        return Promise.resolve(this.graph.get(reference.id));
    }
}

describe("SolutionRestore", () =>
{
    test("warms the cache with a root and its transitive deps", async (t) =>
    {
        const upstream = new CountingUpstream(new Map([
            ["a", pkg([ref("b")])],
            ["b", pkg([])],
        ]));
        const cache = new SolutionCacheSource(new FakeStorage());
        const restore = new SolutionRestore(new CachingPackageSource(cache, upstream));

        const result = await restore.Restore([ref("a")]);

        assert.notEqual(await cache.TryGet(ref("a")), undefined);
        assert.notEqual(await cache.TryGet(ref("b")), undefined);
        assert.deepEqual(result.Missing, []);
        assert.equal(result.Restored.length, 2);
    });

    test("reports an unresolvable root as missing and caches nothing", async () =>
    {
        const cache = new SolutionCacheSource(new FakeStorage());
        const restore = new SolutionRestore(new CachingPackageSource(cache, new CountingUpstream(new Map())));

        const result = await restore.Restore([ref("gone")]);

        assert.equal(await cache.TryGet(ref("gone")), undefined);
        assert.deepEqual(result.Restored, []);
        assert.deepEqual(result.Missing.map((r) => r.id), ["gone"]);
    });

    test("fetches a shared transitive dep only once (diamond)", async () =>
    {
        const upstream = new CountingUpstream(new Map([
            ["a", pkg([ref("b"), ref("c")])],
            ["b", pkg([ref("d")])],
            ["c", pkg([ref("d")])],
            ["d", pkg([])],
        ]));
        const cache = new SolutionCacheSource(new FakeStorage());
        const restore = new SolutionRestore(new CachingPackageSource(cache, upstream));

        await restore.Restore([ref("a")]);

        // Exactly the four distinct packages are fetched — d is not fetched twice.
        assert.equal(upstream.Fetches, 4);
    });
});
