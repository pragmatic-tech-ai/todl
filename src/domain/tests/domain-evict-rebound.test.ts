import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compilePackage, PackageKind } from "../../publish/publish.js";
import { PackageManifestBridge } from "../../solution-services/package-manager/package-manifest-bridge.js";
import { Domain } from "../domain.js";
import { MemoryPackageSource } from "../memory-package-source.js";
import { MetadataSnapshot } from "../metadata-snapshot.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";

/** pkg.a declares a.a1; pkg.b imports pkg.a and, seeded from its full closure, re-binds a.a1 with its own values. */
class ReboundFixture
{
    public static readonly Version = "1.0.0";
    public static readonly PackageA = "pkg.a";
    public static readonly PackageB = "pkg.b";
    public static readonly A1 = "a.a1";
    public static readonly B1 = "b.b1";
    public static readonly Label = "label";
    public static readonly HomeLabel = "home";
    public static readonly ReboundLabel = "rebound";
    private static readonly SourceA = `namespace a { concept A { } model MA : a { A a1 { label = "${ReboundFixture.HomeLabel}"; } } }`;
    private static readonly SourceB = "namespace b { import a; model MB : a { a.A b1 { } } }";

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
            nodes: seedB.nodes.map((n) => n.id === ReboundFixture.A1 ? { ...n, attrs: { ...n.attrs, [ReboundFixture.Label]: ReboundFixture.ReboundLabel } } : n),
        };
        const domain = new Domain(new MemoryPackageSource([PackageManifestBridge.toResolved(a.package!), resolvedB]));
        await domain.load({ model: ReboundFixture.PackageB, version: ReboundFixture.Version });
        return domain;
    }
}

/** A bare snapshot with pkg.a and pkg.b registered (one Widget concept each), seeded directly. */
class SnapshotFixture
{
    public static readonly Version = "1.0.0";
    public static readonly PackageA = "pkg.a";
    public static readonly PackageB = "pkg.b";
    public static readonly OriginA = `${SnapshotFixture.PackageA}@${SnapshotFixture.Version}`;
    public static readonly OriginB = `${SnapshotFixture.PackageB}@${SnapshotFixture.Version}`;
    public static readonly Widget = "Widget";
    public static readonly W1 = "w1";
    public static readonly X = "x";
    public static readonly Y = "y";
    public static readonly Parts = "parts";
    public static readonly Label = "label";
    public static readonly HomeLabel = "home";
    public static readonly ReboundLabel = "rebound";

    /** pkg.a binds w1 (home values, parts -> x); pkg.b then re-binds w1 (its own values, parts -> y). */
    public static Rebound(): MetadataSnapshot
    {
        const snapshot = new MetadataSnapshot();
        for (const model of [SnapshotFixture.PackageA, SnapshotFixture.PackageB])
        {
            const manifest = Manifest.load(SnapshotFixture.Manifest(model));
            snapshot.PreRegister(manifest);
            snapshot.Finalize(manifest);
        }
        snapshot.BindSeed({
            nodes: [{ id: SnapshotFixture.W1, type: SnapshotFixture.Widget, attrs: { [SnapshotFixture.Label]: SnapshotFixture.HomeLabel } }],
            edges: [{ from: SnapshotFixture.W1, rel: SnapshotFixture.Parts, to: SnapshotFixture.X }],
        }, { model: SnapshotFixture.PackageA, version: SnapshotFixture.Version });
        snapshot.BindSeed({
            nodes: [{ id: SnapshotFixture.W1, type: SnapshotFixture.Widget, attrs: { [SnapshotFixture.Label]: SnapshotFixture.ReboundLabel } }],
            edges: [{ from: SnapshotFixture.W1, rel: SnapshotFixture.Parts, to: SnapshotFixture.Y }],
        }, { model: SnapshotFixture.PackageB, version: SnapshotFixture.Version });
        return snapshot;
    }

    private static Manifest(model: string): ReturnType<ManifestWriter["toJSON"]>
    {
        const logical: LogicalManifest = {
            format: "todl-manifest/1", model, version: SnapshotFixture.Version, root: "Element",
            concepts: {
                Element: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
                [SnapshotFixture.Widget]: { extends: "Element", fields: { [SnapshotFixture.Label]: { type: "string", card: "?" } }, relationships: {}, invariants: [], annotations: [] },
            },
            classes: {}, taxonomies: {},
        };
        return ManifestWriter.fromLogical(logical).toJSON();
    }
}

describe("Domain evict of a re-binding dependent", () =>
{
    test("evicting a dependent keeps the dependency's re-bound instances", async () =>
    {
        const domain = await ReboundFixture.Domain();
        const snapshot = domain.Snapshot;
        assert.equal(snapshot.OriginModelOf(ReboundFixture.A1), ReboundFixture.PackageB);
        assert.equal(snapshot.getNode(ReboundFixture.A1)?.attrs[ReboundFixture.Label], ReboundFixture.ReboundLabel);

        assert.equal(domain.tryUnload({ model: ReboundFixture.PackageB, version: ReboundFixture.Version }), true);

        const a1 = snapshot.getNode(ReboundFixture.A1);
        assert.ok(a1, "a.a1 survives its re-binder's unload");
        assert.equal(a1.attrs[ReboundFixture.Label], ReboundFixture.HomeLabel);
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

describe("MetadataSnapshot.Evict of re-bound nodes", () =>
{
    test("evicting the re-binder restores the home node's refs as well as its attrs", () =>
    {
        const snapshot = SnapshotFixture.Rebound();
        assert.deepEqual(snapshot.getNode(SnapshotFixture.W1)?.refs?.[SnapshotFixture.Parts], [SnapshotFixture.Y]);

        snapshot.Evict(SnapshotFixture.OriginB);

        const w1 = snapshot.getNode(SnapshotFixture.W1);
        assert.ok(w1);
        assert.equal(w1.attrs[SnapshotFixture.Label], SnapshotFixture.HomeLabel);
        assert.deepEqual(w1.refs?.[SnapshotFixture.Parts], [SnapshotFixture.X]);
        assert.equal(snapshot.originOf(SnapshotFixture.W1), SnapshotFixture.OriginA);
        assert.equal(snapshot.HomeModelOf(SnapshotFixture.W1), SnapshotFixture.PackageA);
    });

    test("evicting the home while a re-binder holds the node keeps it, and the re-binder becomes its home", () =>
    {
        const snapshot = SnapshotFixture.Rebound();

        snapshot.Evict(SnapshotFixture.OriginA);

        const w1 = snapshot.getNode(SnapshotFixture.W1);
        assert.ok(w1);
        assert.equal(w1.attrs[SnapshotFixture.Label], SnapshotFixture.ReboundLabel);
        assert.deepEqual(w1.refs?.[SnapshotFixture.Parts], [SnapshotFixture.Y]);
        assert.equal(snapshot.originOf(SnapshotFixture.W1), SnapshotFixture.OriginB);
        assert.equal(snapshot.OriginModelOf(SnapshotFixture.W1), SnapshotFixture.PackageB);
        assert.equal(snapshot.HomeModelOf(SnapshotFixture.W1), SnapshotFixture.PackageB);

        // The re-binder is now the node's only binder: evicting it removes the node.
        snapshot.Evict(SnapshotFixture.OriginB);
        assert.equal(snapshot.getNode(SnapshotFixture.W1), undefined);
        assert.equal(snapshot.HomeModelOf(SnapshotFixture.W1), undefined);
        assert.equal(snapshot.size, 0);
    });
});
