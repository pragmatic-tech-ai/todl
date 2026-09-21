import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { PackageCompiler } from "../index.js";
import { MemorySink } from "../sinks.js";
import { StoragePackageStore } from "../../todl-build-system/package-store.js";
import type { IPackageSource } from "../../todl-build-system/package-source.js";

const PROJECTS = join(dirname(fileURLToPath(import.meta.url)), "../../../../test_projects");
const emptyBackends = (): IPackageSource => new StoragePackageStore(new FakeStorage());

/** Compile the meta-model (no deps) and publish its model.json into a fresh package
 *  store — the storage-backed equivalent of installing the dependency, so a library
 *  resolves its base from it. */
async function backendsWithMetaModel(): Promise<IPackageSource>
{
  const sink = new MemorySink();
  const r = await new PackageCompiler(emptyBackends(), { createSink: () => sink }).compile(join(PROJECTS, "meta-models/tech-architecture"));
  assert.ok(r.ok, `meta-model compiles: ${r.errors.map((e) => e.message).join(", ")}`);
  const store = new FakeStorage();
  await store.WriteText("todl-test-tech-architecture/0.1.0/model.json", sink.files.get("model.json") as string);
  return new StoragePackageStore(store);
}

test("compile builds against published bases and writes dist/", async () => {
  const backends = await backendsWithMetaModel();
  const outDir = join(mkdtempSync(join(tmpdir(), "todl-pc-")), "dist");
  const result = await new PackageCompiler(backends).compile(join(PROJECTS, "libraries/microsoft"), { outDir });
  assert.ok(result.ok, `expected clean pack; errors: ${result.errors.map((e) => e.message).join(", ")}`);

  const pkg = JSON.parse(readFileSync(join(outDir, "package.json"), "utf8"));
  assert.equal(pkg.name, "@pragmatic-tech-ai/todl-test-microsoft");
  assert.deepEqual(pkg.dependencies, { "@pragmatic-tech-ai/todl-test-tech-architecture": "0.1.0" });
  assert.match(readFileSync(join(outDir, "index.js"), "utf8"), /export const document =/);
});

test("compile honors a scope override for the package + dependency names", async () => {
  const backends = await backendsWithMetaModel();
  const outDir = join(mkdtempSync(join(tmpdir(), "todl-pc-")), "dist");
  const result = await new PackageCompiler(backends).compile(join(PROJECTS, "libraries/microsoft"), { scope: "@acme", outDir });
  assert.ok(result.ok, `expected clean pack; errors: ${result.errors.map((e) => e.message).join(", ")}`);
  const pkg = JSON.parse(readFileSync(join(outDir, "package.json"), "utf8"));
  assert.equal(pkg.name, "@acme/todl-test-microsoft");
  assert.deepEqual(pkg.dependencies, { "@acme/todl-test-tech-architecture": "0.1.0" });
});
