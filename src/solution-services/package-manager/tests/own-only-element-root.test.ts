import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { compilePackage } from "../../../publish/publish.js";
import type { CompiledPackage } from "../../../publish/publish.js";
import { ManifestEmitter } from "../../../compiler-services/emit/manifest.js";
import { ELEMENT_ID } from "../../../compiler-services/model/model.js";
import { Domain } from "../../../domain/domain.js";
import { GraphQuery } from "../../../graph-api/index.js";
import { PackageManifestBridge } from "../package-manifest-bridge.js";
import { StoragePackageSource } from "../storage-package-source.js";

/** A published package keeps only its own nodes (no prelude), yet its parent-less concepts still inherit Element. */
class OwnOnlyFixture
{
    public static readonly Model = "shop.p";
    public static readonly Version = "1.0.0";
    public static readonly ModelPath = "shop.p/1.0.0/model.json";
    public static readonly Source = 'namespace shop { concept Base { code : string?; } concept Widget { owningBu : string; } concept Gadget : Base { } '
        + 'model Shop : shop { Widget w0 { owningBu = "s"; label = "seed"; description = "about"; } } }';

    public static Compile(): CompiledPackage
    {
        const out = compilePackage([], [{ uri: "shop.todl", text: OwnOnlyFixture.Source }], { id: OwnOnlyFixture.Model, version: OwnOnlyFixture.Version });
        assert.ok(out.ok, JSON.stringify(out.errors));
        return out.package!;
    }

    public static async Query(): Promise<GraphQuery>
    {
        const storage = new FakeStorage();
        await storage.WriteText(OwnOnlyFixture.ModelPath, JSON.stringify(OwnOnlyFixture.Compile().document));
        const domain = new Domain(new StoragePackageSource(storage));
        await domain.load({ model: OwnOnlyFixture.Model, version: OwnOnlyFixture.Version });
        return new GraphQuery(domain.graph);
    }
}

test("an own-only document carries no prelude, but its repository roots parent-less concepts at Element", () =>
{
    const pkg = OwnOnlyFixture.Compile();
    assert.ok(!pkg.document.nodes.some((n) => n.id === ELEMENT_ID));
    const manifest = new ManifestEmitter(PackageManifestBridge.repositoryOf(pkg.document), OwnOnlyFixture.Model, OwnOnlyFixture.Version).emitManifest();
    assert.deepEqual(Object.keys(manifest.concepts[ELEMENT_ID]!.fields).sort(), ["description", "label"]);
    assert.equal(manifest.concepts["shop.Widget"]!.extends, ELEMENT_ID);
    assert.equal(manifest.concepts["shop.Base"]!.extends, ELEMENT_ID);
    assert.equal(manifest.concepts["shop.Gadget"]!.extends, "shop.Base");
});

test("the own-only and the full document emit the same concepts and parents", () =>
{
    const pkg = OwnOnlyFixture.Compile();
    const own = new ManifestEmitter(PackageManifestBridge.repositoryOf(pkg.document), OwnOnlyFixture.Model, OwnOnlyFixture.Version).emitManifest();
    const full = new ManifestEmitter(PackageManifestBridge.repositoryOf(pkg.fullDocument), OwnOnlyFixture.Model, OwnOnlyFixture.Version).emitManifest();
    assert.deepEqual(Object.keys(own.concepts).sort(), Object.keys(full.concepts).sort());
    for (const id of Object.keys(own.concepts))
    {
        assert.equal(own.concepts[id]!.extends, full.concepts[id]!.extends, id);
    }
});

test("a stored package read through StoragePackageSource reflects the inherited Element fields", async () =>
{
    const query = await OwnOnlyFixture.Query();
    const widget = query.Type("shop.Widget");
    assert.equal(widget?.baseType?.fullName, ELEMENT_ID);
    assert.deepEqual(widget?.getFields().map((f) => f.name).sort(), ["description", "label", "owningBu"]);
    assert.deepEqual(query.Type("shop.Gadget")?.getFields().map((f) => f.name).sort(), ["code", "description", "label"]);
});

test("a stored package's seeded instance keeps its inherited label and description values", async () =>
{
    const query = await OwnOnlyFixture.Query();
    const w0 = query.InstancesOf("shop.Widget")[0];
    assert.ok(w0 !== undefined);
    const values = Object.fromEntries(w0.fields().map((fv) => [fv.field.name, fv.value]));
    assert.deepEqual(values, { owningBu: "s", label: "seed", description: "about" });
});

test("toResolvedJsonDocument of an own-only document keeps the seed's inherited values", () =>
{
    const resolved = PackageManifestBridge.toResolvedJsonDocument(OwnOnlyFixture.Compile().document, OwnOnlyFixture.Model, OwnOnlyFixture.Version, []);
    assert.deepEqual(resolved.seed?.nodes.map((n) => n.attrs), [{ owningBu: "s", label: "seed", description: "about" }]);
});
