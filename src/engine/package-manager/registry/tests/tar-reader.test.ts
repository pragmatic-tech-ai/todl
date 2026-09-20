import { test } from "node:test";
import assert from "node:assert/strict";
import { createTgz } from "../tar.js";
import { TarReader } from "../tar-reader.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

test("read round-trips the entries createTgz wrote (paths + exact bytes)", () => {
  const entries = [
    { path: "package/package.json", bytes: enc.encode('{"name":"x"}') },
    { path: "package/model.json", bytes: enc.encode('{"nodes":[]}') },
    { path: "package/src/microsoft.todl", bytes: enc.encode("concept X;\n") },
  ];
  const files = TarReader.read(createTgz(entries));
  const byPath = new Map(files.map((f) => [f.path, f.bytes]));
  assert.deepEqual([...byPath.keys()].sort(), entries.map((e) => e.path).sort());
  for (const e of entries) assert.ok(same(byPath.get(e.path)!, e.bytes), `bytes differ for ${e.path}`);
});

test("read handles a body whose length is an exact multiple of 512 (no stray padding)", () => {
  const body = enc.encode("a".repeat(512));
  const files = TarReader.read(createTgz([{ path: "package/big", bytes: body }]));
  assert.equal(files.length, 1);
  assert.ok(same(files[0]!.bytes, body));
});

test("read reconstructs a path long enough to use the USTAR prefix split", () => {
  const longPath = `package/${"d/".repeat(60)}leaf.todl`; // > 100 bytes → prefix+name split
  const files = TarReader.read(createTgz([{ path: longPath, bytes: enc.encode("z") }]));
  assert.equal(files[0]!.path, longPath);
});

test("readPackage builds an InstalledPackage from a TODL package tarball", () => {
  const pkgJson = { name: "@pragmatic-tech-ai/aws", dependencies: { "@pragmatic-tech-ai/tech-architecture": "0.1.0" }, todl: { kind: "library", id: "aws" } };
  const model = { nodes: [{ id: "n1" }], edges: [] };
  const tgz = createTgz([
    { path: "package/package.json", bytes: enc.encode(JSON.stringify(pkgJson)) },
    { path: "package/model.json", bytes: enc.encode(JSON.stringify(model)) },
  ]);
  const pkg = TarReader.readPackage(tgz);
  assert.ok(pkg !== undefined);
  assert.equal(pkg!.name, "@pragmatic-tech-ai/aws");
  assert.deepEqual(pkg!.meta, { kind: "library", id: "aws" });
  assert.deepEqual(pkg!.dependencies, ["@pragmatic-tech-ai/tech-architecture"]);
  assert.equal(dec.decode(enc.encode(JSON.stringify(pkg!.document))), JSON.stringify(model));
});

test("readPackage returns undefined when the tarball is not a TODL package", () => {
  const noTodl = createTgz([{ path: "package/package.json", bytes: enc.encode('{"name":"plain"}') }]);
  assert.equal(TarReader.readPackage(noTodl), undefined);
  const noModel = createTgz([{ path: "package/package.json", bytes: enc.encode('{"name":"x","todl":{"kind":"library","id":"x"}}') }]);
  assert.equal(TarReader.readPackage(noModel), undefined);
});
