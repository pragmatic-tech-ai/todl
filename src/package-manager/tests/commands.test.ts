import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseManifest, packProject, FileSink, packCommand } from "../index.js";

const PROJECTS = join(dirname(fileURLToPath(import.meta.url)), "../../../test_projects");

type Src = { uri: string; text: string };
function sources(project: string): Src[] {
  const root = join(PROJECTS, project);
  const walk = (dir: string): Src[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return e.name.endsWith(".todl")
        ? [{ uri: p.slice(root.length + 1).split("\\").join("/"), text: readFileSync(p, "utf8") }]
        : [];
    });
  return walk(root);
}
const manifest = (project: string) => parseManifest(readFileSync(join(PROJECTS, project, "project.plexus"), "utf8"));

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
  await packProject(
    { manifest: manifest("meta-models/tech-architecture"), sources: sources("meta-models/tech-architecture"), bases: [] },
    new FileSink(dep),
    { scope },
  );
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
