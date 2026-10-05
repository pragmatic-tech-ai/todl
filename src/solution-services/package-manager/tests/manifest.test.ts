import { test } from "node:test";
import assert from "node:assert/strict";
import { ManifestParser, parseManifest, ProjectType } from "../index.js";

// Legacy (pre-plural-bindings) manifests that still live on disk in older projects.
// ManifestParser.Parse must upgrade them to the current schema so base resolution
// (which reads metaModels + packageVersion) sees the dependency instead of 0 bases.

test("legacy meta-model: modelVersion → packageVersion", () =>
{
  const m = ManifestParser.Parse(JSON.stringify({
    type: "meta-model", name: "tech-architecture", version: 1,
    id: "tech-architecture", modelVersion: "0.3.0",
  }));
  assert.equal(m.packageVersion, "0.3.0");
  assert.equal((m as unknown as Record<string, unknown>).modelVersion, undefined);
});

test("legacy library: libVersion → packageVersion and metaModel → metaModels[]", () =>
{
  const m = ManifestParser.Parse(JSON.stringify({
    type: "library", name: "aws", version: 1, id: "aws", libVersion: "0.1.0",
    metaModel: { id: "tech-architecture", version: "0.3.0" },
  }));
  assert.equal(m.packageVersion, "0.1.0");
  assert.deepEqual(m.metaModels, [{ id: "tech-architecture", version: "0.3.0" }]);
  assert.equal((m as unknown as Record<string, unknown>).libVersion, undefined);
  assert.equal((m as unknown as Record<string, unknown>).metaModel, undefined);
});

test("legacy architecture: singular metaModel → metaModels[] (libraries untouched)", () =>
{
  const m = ManifestParser.Parse(JSON.stringify({
    type: "architecture", name: "test_arch", version: 1,
    metaModel: { id: "tech-architecture", version: "0.2.0" },
    libraries: [{ id: "microsoft", version: "0.1.0" }],
  }));
  assert.deepEqual(m.metaModels, [{ id: "tech-architecture", version: "0.2.0" }]);
  assert.deepEqual(m.libraries, [{ id: "microsoft", version: "0.1.0" }]);
});

test("current schema is passed through unchanged", () =>
{
  const current = {
    type: ProjectType.Library, name: "aws", version: 1, id: "aws",
    packageVersion: "0.1.0", metaModels: [{ id: "tech-architecture", version: "0.3.0" }],
  };
  assert.deepEqual(ManifestParser.Parse(JSON.stringify(current)), current);
});

test("half-migrated manifest keeps its plural bindings (current wins over legacy)", () =>
{
  const m = ManifestParser.Parse(JSON.stringify({
    type: "library", name: "aws", version: 1, id: "aws",
    libVersion: "0.1.0", packageVersion: "0.2.0",
    metaModels: [{ id: "tech-architecture", version: "0.3.0" }],
    metaModel: { id: "stale", version: "9.9.9" },
  }));
  assert.equal(m.packageVersion, "0.2.0");
  assert.deepEqual(m.metaModels, [{ id: "tech-architecture", version: "0.3.0" }]);
});

test("parseManifest delegates to ManifestParser (legacy normalized through the shim)", () =>
{
  const m = parseManifest(JSON.stringify({
    type: "meta-model", name: "mm", version: 1, id: "mm", modelVersion: "1.2.3",
  }));
  assert.equal(m.packageVersion, "1.2.3");
});
