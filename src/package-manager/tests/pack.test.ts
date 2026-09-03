import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { check } from "../../api.js";
import { toJSON } from "../../emit/json.js";
import { parseManifest, packProject, MemorySink } from "../index.js";

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

// Compile the meta-model once to serve as the library's resolved base.
const metaDoc = toJSON(check(sources("meta-models/tech-architecture")).model);

test("packs a meta-model into the npm package layout", async () => {
  const sink = new MemorySink();
  const result = await packProject(
    { manifest: manifest("meta-models/tech-architecture"), sources: sources("meta-models/tech-architecture"), bases: [] },
    sink,
  );
  assert.ok(result.ok, `expected clean pack; errors: ${result.errors.map((e) => e.message).join(", ")}`);
  for (const f of ["package.json", "model.json", "index.js", "index.d.ts"]) assert.ok(sink.files.has(f), `wrote ${f}`);
  assert.ok([...sink.files.keys()].some((p) => p.startsWith("src/")), "wrote src/");

  const pkg = JSON.parse(sink.files.get("package.json") as string);
  assert.equal(pkg.name, "@pragmatic-tech-ai/todl-test-tech-architecture");
  assert.equal(pkg.version, "0.1.0");
  assert.deepEqual(pkg.todl, { kind: "meta-model", id: "todl-test-tech-architecture" });
  assert.match(sink.files.get("index.js") as string, /export const document =/);
});

test("packs a library carrying its meta-model dependency", async () => {
  const sink = new MemorySink();
  const result = await packProject(
    { manifest: manifest("libraries/microsoft"), sources: sources("libraries/microsoft"), bases: [metaDoc] },
    sink,
  );
  assert.ok(result.ok, `expected clean pack; errors: ${result.errors.map((e) => e.message).join(", ")}`);
  const pkg = JSON.parse(sink.files.get("package.json") as string);
  assert.deepEqual(pkg.dependencies, { "@pragmatic-tech-ai/todl-test-tech-architecture": "0.1.0" });
  assert.deepEqual(pkg.todl, { kind: "library", id: "todl-test-microsoft" });
});

test("refuses to pack an architecture (not published)", async () => {
  await assert.rejects(
    packProject({ manifest: manifest("architectures/test_architecture"), sources: [], bases: [] }, new MemorySink()),
    /not published/,
  );
});
