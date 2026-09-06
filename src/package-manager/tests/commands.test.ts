import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PackageCompiler, packCommand } from "../index.js";

const PROJECTS = join(dirname(fileURLToPath(import.meta.url)), "../../../test_projects");

/** A temp copy of the microsoft library project with its meta-model dependency
 *  installed into node_modules under `scope` — a realistic "ready to pack" project.
 *  The dependency is installed under the SAME scope the project will pack with,
 *  as it would be in real usage. */
async function setupLibraryProject(scope = "@pragmatic-tech-ai"): Promise<string> {
  const dir = join(mkdtempSync(join(tmpdir(), "todl-cli-")), "microsoft");
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(PROJECTS, "libraries/microsoft/project.plexus"), join(dir, "project.plexus"));
  copyFileSync(join(PROJECTS, "libraries/microsoft/microsoft.todl"), join(dir, "microsoft.todl"));
  const dep = join(dir, "node_modules", scope, "todl-test-tech-architecture");
  // Compile the meta-model project straight into the library's node_modules (it has
  // no deps of its own, so this is offline). Mirrors a real `npm install` of the dep.
  await new PackageCompiler().compile(join(PROJECTS, "meta-models/tech-architecture"), { scope, outDir: dep });
  return dir;
}

test("packCommand compiles against installed deps and writes dist/", async () => {
  const dir = await setupLibraryProject();
  const result = await packCommand(dir);
  assert.ok(result.ok, `expected clean pack; errors: ${result.errors.map((e) => e.message).join(", ")}`);

  const pkg = JSON.parse(readFileSync(join(dir, "dist", "package.json"), "utf8"));
  assert.equal(pkg.name, "@pragmatic-tech-ai/todl-test-microsoft");
  assert.deepEqual(pkg.dependencies, { "@pragmatic-tech-ai/todl-test-tech-architecture": "0.1.0" });
  // model.json + the embedded handle were written alongside it.
  assert.match(readFileSync(join(dir, "dist", "index.js"), "utf8"), /export const document =/);
});

test("packCommand honors a scope override end-to-end (name + resolution)", async () => {
  const dir = await setupLibraryProject("@acme");
  const result = await packCommand(dir, { scope: "@acme" });
  assert.ok(result.ok, `expected clean pack; errors: ${result.errors.map((e) => e.message).join(", ")}`);
  const pkg = JSON.parse(readFileSync(join(dir, "dist", "package.json"), "utf8"));
  assert.equal(pkg.name, "@acme/todl-test-microsoft");
  assert.deepEqual(pkg.dependencies, { "@acme/todl-test-tech-architecture": "0.1.0" });
});
