import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseManifest, toPackageJson, ProjectType } from "../index.js";

// Resolve against the real test_projects manifests (near-real-life fixtures),
// independent of the process cwd.
const PROJECTS = join(dirname(fileURLToPath(import.meta.url)), "../../../test_projects");
const manifest = (project: string) =>
  parseManifest(readFileSync(join(PROJECTS, project, "project.plexus"), "utf8"));

test("meta-model manifest → package.json with no dependencies", () => {
  const pkg = toPackageJson(manifest("meta-models/tech-architecture"));
  assert.equal(pkg.name, "@pragmatic-tech-ai/todl-test-tech-architecture");
  assert.equal(pkg.version, "0.1.0");
  assert.deepEqual(pkg.dependencies, {});
  assert.deepEqual(pkg.todl, { kind: ProjectType.MetaModel, id: "todl-test-tech-architecture" });
  assert.equal(pkg.main, "index.js");
});

test("library manifest → package.json depends on its meta-model", () => {
  const pkg = toPackageJson(manifest("libraries/microsoft"));
  assert.equal(pkg.name, "@pragmatic-tech-ai/todl-test-microsoft");
  assert.equal(pkg.version, "0.1.0");
  assert.deepEqual(pkg.dependencies, { "@pragmatic-tech-ai/todl-test-tech-architecture": "0.1.0" });
  assert.deepEqual(pkg.todl, { kind: ProjectType.Library, id: "todl-test-microsoft" });
});

test("scope is parametrised (name + dependency prefixes)", () => {
  const pkg = toPackageJson(manifest("libraries/aws"), { scope: "@acme" });
  assert.equal(pkg.name, "@acme/todl-test-aws");
  assert.deepEqual(pkg.dependencies, { "@acme/todl-test-tech-architecture": "0.1.0" });
});

test("an architecture is not publishable", () => {
  assert.throws(() => toPackageJson(manifest("architectures/test_architecture")), /not published/);
});
