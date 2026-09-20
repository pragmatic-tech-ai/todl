import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { Repository } from "../../../model/model.js";
import { Cardinality } from "../../../model/graph.js";
import { toJSON } from "../../../emit/json.js";
import { BlobPackageStore, type PackageSink } from "../../../publish/stores.js";
import { PackageKind, type CompiledPackage, type PackageDocument } from "../../../publish/publish.js";
import { Domain } from "../../../domain/domain.js";
import { Manifest } from "../../../manifest/reflection/reflection.js";
import type { ManifestJson } from "../../../manifest/records.js";
import { StoragePackageSource } from "../storage-package-source.js";

// ── fixtures ──────────────────────────────────────────────────────────────

// A self-contained ontology + instances: concept Widget (label?) with a `next`
// relationship; two instances shop.hero (label "Hi") --next--> shop.tail. Emitting
// this repo to a TodlDocument gives the exact `model.json` a published package
// carries, so the source is exercised against a real round-trip.
function buildRepo(): Repository
{
  const repo = new Repository();
  repo
    .builder()
    .defineConcept("Element")
    .defineConcept("Widget", "Element")
    .addField("Widget", "label", "string", Cardinality.Optional)
    .addConceptRelationship("Widget", "next", ["Widget"], Cardinality.Optional, "prev")
    .setNamespace("shop")
    .assertInstance("Widget", "shop.hero")
    .setField("shop.hero", "label", "Hi")
    .assertInstance("Widget", "shop.tail")
    .addRelationship("shop.hero", "next", "shop.tail")
    .commit();
  return repo;
}

// A PackageSink over an IStorage (mirrors StoragePackageSink) — kept inline so the
// test proves BlobPackageStore's on-disk layout is exactly what the source reads.
function sink(storage: IStorage): PackageSink
{
  return { writeText: (p, c) => storage.WriteText(p, c) };
}

function packageOf(doc: PackageDocument, id: string, version: string): CompiledPackage
{
  return { id, version, document: doc, fullDocument: doc, sources: [{ uri: `${id}.todl`, text: "" }], classes: [] };
}

// Publish `buildRepo()` as `<id>/<version>/model.json` into a fresh FakeStorage.
async function published(id = "shop", version = "1.0.0"): Promise<FakeStorage>
{
  const storage = new FakeStorage();
  const doc = toJSON(buildRepo()) as PackageDocument;
  await new BlobPackageStore(sink(storage)).persist(packageOf(doc, id, version));
  return storage;
}

// ── tests ───────────────────────────────────────────────────────────────

describe("StoragePackageSource — resolve", () => {
  test("resolves a BlobPackageStore package to a manifest that Manifest.load reads", async () => {
    const storage = await published();
    const resolved = await new StoragePackageSource(storage).resolve({ model: "shop", version: "1.0.0" });

    assert.deepEqual(resolved.ref, { model: "shop", version: "1.0.0" });
    const manifest = resolved.manifest as ManifestJson;
    assert.equal(manifest.model, "shop");
    assert.equal(manifest.version, "1.0.0");

    const m = Manifest.load(resolved.manifest);
    assert.equal(m.getType("Widget")?.name, "Widget");
  });

  test("carries the instance graph as the seed (nodes + edges)", async () => {
    const storage = await published();
    const resolved = await new StoragePackageSource(storage).resolve({ model: "shop", version: "1.0.0" });

    assert.ok(resolved.seed);
    assert.deepEqual(resolved.seed!.nodes.map((n) => n.id).sort(), ["shop.hero", "shop.tail"]);
    const hero = resolved.seed!.nodes.find((n) => n.id === "shop.hero")!;
    assert.equal(hero.type, "Widget");
    assert.equal(hero.attrs.label, "Hi");
    assert.deepEqual(resolved.seed!.edges, [{ from: "shop.hero", rel: "next", to: "shop.tail" }]);
  });

  test("maps recorded publish dependencies to domain refs", async () => {
    const storage = new FakeStorage();
    const doc = toJSON(buildRepo()) as PackageDocument;
    doc.dependencies = [{ kind: PackageKind.MetaModel, id: "base", version: "1.2.3" }];
    await new BlobPackageStore(sink(storage)).persist(packageOf(doc, "shop", "1.0.0"));

    const resolved = await new StoragePackageSource(storage).resolve({ model: "shop", version: "1.0.0" });
    assert.deepEqual(resolved.dependencies, [{ model: "base", version: "1.2.3" }]);
  });

  test("rejects an unknown package", async () => {
    const storage = await published();
    await assert.rejects(new StoragePackageSource(storage).resolve({ model: "nope", version: "1.0.0" }));
  });
});

describe("StoragePackageSource — versions + latest pinning", () => {
  test("versions lists the published versions of a model", async () => {
    const storage = await published("shop", "1.0.0");
    await new BlobPackageStore(sink(storage)).persist(packageOf(toJSON(buildRepo()) as PackageDocument, "shop", "2.0.0"));

    const src = new StoragePackageSource(storage);
    assert.deepEqual([...(await src.versions("shop"))].sort(), ["1.0.0", "2.0.0"]);
  });

  test("resolve without a version pins to the semver-latest", async () => {
    const storage = await published("shop", "1.9.0");
    await new BlobPackageStore(sink(storage)).persist(packageOf(toJSON(buildRepo()) as PackageDocument, "shop", "1.10.0"));

    const resolved = await new StoragePackageSource(storage).resolve({ model: "shop" });
    assert.equal(resolved.ref.version, "1.10.0");
  });
});

describe("StoragePackageSource — end-to-end compose through Domain", () => {
  test("Domain.load composes the manifest and seeds the instance graph", async () => {
    const storage = await published();
    const domain = new Domain(new StoragePackageSource(storage));

    await domain.load({ model: "shop", version: "1.0.0" });

    assert.equal(domain.getManifest("shop")?.version, "1.0.0");
    const hero = domain.graph.getNode("shop.hero");
    assert.ok(hero);
    const mirror = domain.reflect(hero!);
    assert.equal(mirror.type.name, "Widget");
    assert.equal(mirror.field("label")?.value, "Hi");
  });
});
