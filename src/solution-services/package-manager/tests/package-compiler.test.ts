import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { check } from "../../../compiler-services/api.js";
import { toJSON, type TodlDocument } from "../../../compiler-services/emit/json.js";
import { parseManifest } from "../manifest.js";
import { MemorySink } from "../sinks.js";
import type { Project } from "../project.js";
import { PackageCompiler, type ProjectReader } from "../package-compiler.js";
import { StoragePackageStore } from "../../todl-build-system/package-store.js";
import type { IPackageSource } from "../../todl-build-system/package-source.js";

const PROJECTS = join(dirname(fileURLToPath(import.meta.url)), "../../../../test_projects");
type Src = { uri: string; text: string };
function sources(project: string): Src[]
{
  const root = join(PROJECTS, project);
  const walk = (dir: string): Src[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return e.name.endsWith(".todl") ? [{ uri: p.slice(root.length + 1).split("\\").join("/"), text: readFileSync(p, "utf8") }] : [];
    });
  return walk(root);
}
const manifest = (project: string) => parseManifest(readFileSync(join(PROJECTS, project, "project.plexus"), "utf8"));

/** A reader returning a fixed Project (the pipeline's disk read, faked). */
function reader(project: Project): ProjectReader
{
  return { read: () => project };
}
/** An empty package source — for projects that declare no bases. */
const emptyBackends = (): IPackageSource => new StoragePackageStore(new FakeStorage());
/** A source with one meta-model published at `<id>/<version>/model.json`. */
async function backendsWith(id: string, version: string, doc: TodlDocument): Promise<IPackageSource>
{
  const store = new FakeStorage();
  await store.WriteText(`${id}/${version}/model.json`, JSON.stringify(doc));
  return new StoragePackageStore(store);
}

const metaDoc = toJSON(check(sources("meta-models/tech-architecture")).model);

test("compiles a meta-model into the npm package layout", async () => {
  const sink = new MemorySink();
  const project: Project = { directory: "/x", manifest: manifest("meta-models/tech-architecture"), sources: sources("meta-models/tech-architecture"), resources: [] };
  const compiler = new PackageCompiler(emptyBackends(), { reader: reader(project), createSink: () => sink });

  const result = await compiler.compile("/x");
  assert.ok(result.ok, result.errors.map((e) => e.message).join(", "));
  for (const f of ["package.json", "model.json", "index.js", "index.d.ts"]) assert.ok(sink.files.has(f), `wrote ${f}`);
  assert.ok([...sink.files.keys()].some((p) => p.startsWith("src/")), "wrote src/");
  const pkg = JSON.parse(sink.files.get("package.json") as string);
  assert.deepEqual(pkg.todl, { kind: "meta-model", id: "todl-test-tech-architecture" });
  assert.match(sink.files.get("index.js") as string, /export const document =/);
  assert.ok(result.package, "returns the in-memory package");
});

test("compiles a library against published bases + records the dep", async () => {
  const sink = new MemorySink();
  const project: Project = { directory: "/x", manifest: manifest("libraries/microsoft"), sources: sources("libraries/microsoft"), resources: [] };
  const backends = await backendsWith("todl-test-tech-architecture", "0.1.0", metaDoc);
  const compiler = new PackageCompiler(backends, { reader: reader(project), createSink: () => sink });

  const result = await compiler.compile("/x");
  assert.ok(result.ok, result.errors.map((e) => e.message).join(", "));
  const pkg = JSON.parse(sink.files.get("package.json") as string);
  assert.deepEqual(pkg.dependencies, { "@pragmatic-tech-ai/todl-test-tech-architecture": "0.1.0" });
});

test("blocks the compile when a declared base is not published", async () => {
  const project: Project = { directory: "/x", manifest: manifest("libraries/microsoft"), sources: sources("libraries/microsoft"), resources: [] };
  const compiler = new PackageCompiler(emptyBackends(), { reader: reader(project), createSink: () => new MemorySink() });
  await assert.rejects(compiler.compile("/x"), /cannot resolve dependencies/);
});

test("packs non-.todl resources verbatim under resources/", async () => {
  const sink = new MemorySink();
  const enc = new TextEncoder();
  const project: Project = {
    directory: "/x",
    manifest: manifest("meta-models/tech-architecture"),
    sources: sources("meta-models/tech-architecture"),
    resources: [
      { path: "theme.mu", bytes: enc.encode("resources T {}") },
      { path: "img/logo.svg", bytes: enc.encode("<svg/>") },
    ],
  };
  const compiler = new PackageCompiler(emptyBackends(), { reader: reader(project), createSink: () => sink });

  const result = await compiler.compile("/x");
  assert.ok(result.ok, result.errors.map((e) => e.message).join(", "));
  assert.equal(new TextDecoder().decode(sink.binaries.get("resources/theme.mu")), "resources T {}");
  assert.ok(sink.binaries.has("resources/img/logo.svg"), "nested resource path preserved");
  assert.ok(result.files?.includes("resources/theme.mu"), "resource listed in the written files");
});

test("a failing compile writes nothing and returns errors", async () => {
  const sink = new MemorySink();
  const bad: Project = { directory: "/x", manifest: manifest("meta-models/tech-architecture"), sources: [{ uri: "bad.todl", text: "element Broken : DoesNotExist;\n" }], resources: [] };
  const compiler = new PackageCompiler(emptyBackends(), { reader: reader(bad), createSink: () => sink });

  const result = await compiler.compile("/x");
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0, "surfaces errors");
  assert.equal(sink.files.size, 0, "sink untouched on failure");
});

test("refuses to compile an architecture (not published)", async () => {
  const project: Project = { directory: "/x", manifest: manifest("architectures/test_architecture"), sources: [], resources: [] };
  const compiler = new PackageCompiler(emptyBackends(), { reader: reader(project), createSink: () => new MemorySink() });
  await assert.rejects(compiler.compile("/x"), /not published/);
});
