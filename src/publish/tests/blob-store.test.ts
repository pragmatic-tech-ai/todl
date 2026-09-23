import { test } from "node:test";
import assert from "node:assert/strict";
import type { CompiledPackage } from "../publish.js";
import { BlobPackageStore, type PackageSink } from "../stores.js";

function fakeSink()
{
  const files = new Map<string, string>();
  const sink: PackageSink = { writeText: async (p, c) => void files.set(p, c) };
  return { sink, files };
}

function fakeByteSink()
{
  const files = new Map<string, string>();
  const bytes = new Map<string, Uint8Array>();
  const sink: PackageSink = {
    writeText: async (p, c) => void files.set(p, c),
    writeBytes: async (p, b) => void bytes.set(p, b),
  };
  return { sink, files, bytes };
}

function pkgWithResources(): CompiledPackage
{
  return { ...pkg(), resources: [{ path: "resources/a.svg", bytes: new Uint8Array([1, 2, 3]) }] };
}

function pkg(): CompiledPackage
{
  const document = { nodes: [{ id: "ms.a", tier: "Instance", type: "t", metaKind: null, namespace: null, localId: "a", isClass: false, class: null, storageId: null, fields: [], attrs: {} }], edges: [] };
  return {
    id: "ms",
    version: "1.0.0",
    document,
    fullDocument: document, // no bases → the closure equals the own document
    sources: [{ uri: "ms.todl", text: "namespace ms {}" }],
    classes: [],
  };
}

test("BlobPackageStore writes model.json + src/<uri> under <id>/<version>", async () => {
  const { sink, files } = fakeSink();
  await new BlobPackageStore(sink).persist(pkg());
  assert.deepEqual(JSON.parse(files.get("ms/1.0.0/model.json")!), pkg().document);
  assert.equal(files.get("ms/1.0.0/src/ms.todl"), "namespace ms {}");
});

test("BlobPackageStore honours a custom layout", async () => {
  const { sink, files } = fakeSink();
  await new BlobPackageStore(sink, { layout: (id, v) => `packages/${id}@${v}` }).persist(pkg());
  assert.ok(files.has("packages/ms@1.0.0/model.json"));
});

test("BlobPackageStore writes resources under <base>/<path> via writeBytes", async () => {
  const { sink, bytes } = fakeByteSink();
  await new BlobPackageStore(sink).persist(pkgWithResources());
  assert.deepEqual(bytes.get("ms/1.0.0/resources/a.svg"), new Uint8Array([1, 2, 3]));
});

test("BlobPackageStore writes no bytes when the package has no resources", async () => {
  const { sink, bytes } = fakeByteSink();
  await new BlobPackageStore(sink).persist(pkg());
  assert.equal(bytes.size, 0);
});

test("BlobPackageStore throws when resources are present but the sink is text-only", async () => {
  const { sink } = fakeSink(); // no writeBytes
  await assert.rejects(
    () => new BlobPackageStore(sink).persist(pkgWithResources()),
    /resources\/a\.svg/,
  );
});
