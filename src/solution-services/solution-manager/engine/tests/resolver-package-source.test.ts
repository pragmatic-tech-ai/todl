import { test } from "node:test";
import assert from "node:assert/strict";
import { ResolverPackageSource } from "../resolver-package-source.js";
import type { IPackageSource, SourcedPackage } from "../../../todl-build-system/package-source.js";
import type { PackageSource, PackageRef, ResolvedPackage } from "../../../../domain/domain.js";

// A published backend that only knows released versions.
class PublishedFake implements PackageSource
{
    constructor(private readonly table: Record<string, string[]>) {}
    async versions(model: string): Promise<readonly string[]> { return this.table[model] ?? []; }
    async resolve(_ref: PackageRef): Promise<ResolvedPackage> { throw new Error("not used"); }
}

// A live-first source that reports an open in-solution member's version.
class LiveFake implements IPackageSource
{
    constructor(private readonly live: Record<string, string>) {}
    async TryGet(): Promise<SourcedPackage | undefined> { return undefined; }
    async VersionsOf(id: string): Promise<readonly string[]> { const v = this.live[id]; return v === undefined ? [] : [v]; }
}

test("versions() pins an unpublished in-solution member via its live version (#17)", async () => {
    const src = new ResolverPackageSource(new LiveFake({ "acme.lib": "0.1.0" }), new PublishedFake({}));
    // Published has nothing for this member, but the live member reports 0.1.0.
    assert.deepEqual(await src.versions("acme.lib"), ["0.1.0"]);
});

test("versions() merges published releases with the live version, live last (latest)", async () => {
    const src = new ResolverPackageSource(
        new LiveFake({ "acme.lib": "0.3.0" }),
        new PublishedFake({ "acme.lib": ["0.1.0", "0.2.0"] }),
    );
    // Domain.pin takes the last element as latest — the live member must win.
    const versions = await src.versions("acme.lib");
    assert.deepEqual(versions, ["0.1.0", "0.2.0", "0.3.0"]);
    assert.equal(versions[versions.length - 1], "0.3.0");
});

test("versions() falls back to published-only when there is no live member", async () => {
    const src = new ResolverPackageSource(new LiveFake({}), new PublishedFake({ "acme.lib": ["1.0.0"] }));
    assert.deepEqual(await src.versions("acme.lib"), ["1.0.0"]);
});
