import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compilePackage, PackageKind } from "../../publish/publish.js";
import { PackageManifestBridge } from "../../solution-services/package-manager/package-manifest-bridge.js";
import { Domain } from "../domain.js";
import { MemoryPackageSource } from "../memory-package-source.js";

/** pkg.a declares a.a1; pkg.b imports pkg.a and, seeded from its full closure, re-binds a.a1 with its own values. */
class ReboundFixture
{
    public static readonly Version = "1.0.0";
    public static readonly PackageA = "pkg.a";
    public static readonly PackageB = "pkg.b";
    public static readonly A1 = "a.a1";
    public static readonly B1 = "b.b1";
    public static readonly HomeLabel = "home";
    public static readonly ReboundLabel = "rebound";
    private static readonly SourceA = 'namespace a { concept A { } model MA : a { A a1 { label = "home"; } } }';
    private static readonly SourceB = 'namespace b { import a; model MB : a { a.A b1 { } } }';

    public static async Domain(): Promise<Domain>
    {
        const a = compilePackage([], [{ uri: "a.todl", text: ReboundFixture.SourceA }], { id: ReboundFixture.PackageA, version: ReboundFixture.Version });
        assert.ok(a.ok, JSON.stringify(a.errors));
        const b = compilePackage([a.package!.document], [{ uri: "b.todl", text: ReboundFixture.SourceB }],
            { id: ReboundFixture.PackageB, version: ReboundFixture.Version }, [{ kind: PackageKind.Library, id: ReboundFixture.PackageA, version: ReboundFixture.Version }]);
        assert.ok(b.ok, JSON.stringify(b.errors));
        const resolvedB = PackageManifestBridge.toResolved(b.package!);
        // pkg.b's full-closure seed carries a.a1; give its copy a distinct value so the restore is observable.
        const seedB = resolvedB.seed!;
        resolvedB.seed = {
            ...seedB,
            nodes: seedB.nodes.map((n) => n.id === ReboundFixture.A1 ? { ...n, attrs: { ...n.attrs, label: ReboundFixture.ReboundLabel } } : n),
        };
        const domain = new Domain(new MemoryPackageSource([PackageManifestBridge.toResolved(a.package!), resolvedB]));
        await domain.load({ model: ReboundFixture.PackageB, version: ReboundFixture.Version });
        return domain;
    }
}

describe("Domain evict of a re-binding dependent", () =>
{
    test("evicting a dependent keeps the dependency's re-bound instances", async () =>
    {
        const domain = await ReboundFixture.Domain();
        const snapshot = domain.Snapshot;
        assert.equal(snapshot.OriginModelOf(ReboundFixture.A1), ReboundFixture.PackageB);
        assert.equal(snapshot.getNode(ReboundFixture.A1)?.attrs["label"], ReboundFixture.ReboundLabel);

        assert.equal(domain.tryUnload({ model: ReboundFixture.PackageB, version: ReboundFixture.Version }), true);

        const a1 = snapshot.getNode(ReboundFixture.A1);
        assert.ok(a1, "a.a1 survives its re-binder's unload");
        assert.equal(a1.attrs["label"], ReboundFixture.HomeLabel);
        assert.equal(snapshot.OriginModelOf(ReboundFixture.A1), ReboundFixture.PackageA);
        assert.equal(snapshot.HomeModelOf(ReboundFixture.A1), ReboundFixture.PackageA);
        assert.equal(snapshot.originOf(ReboundFixture.A1), `${ReboundFixture.PackageA}@${ReboundFixture.Version}`);
        assert.equal(snapshot.getNode(ReboundFixture.B1), undefined, "pkg.b's own instance is evicted");
    });

    test("unloading the home package itself still removes its instances", async () =>
    {
        const domain = await ReboundFixture.Domain();
        assert.equal(domain.tryUnload({ model: ReboundFixture.PackageB, version: ReboundFixture.Version }), true);
        assert.equal(domain.tryUnload({ model: ReboundFixture.PackageA, version: ReboundFixture.Version }), true);
        assert.equal(domain.Snapshot.getNode(ReboundFixture.A1), undefined);
        assert.equal(domain.Snapshot.HomeModelOf(ReboundFixture.A1), undefined);
        assert.equal(domain.Snapshot.size, 0);
    });
});
