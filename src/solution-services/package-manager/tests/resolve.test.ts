import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { check, checkAgainst } from "../../../api.js";
import { toJSON } from "../../../emit/json.js";
import { DocumentSource, TODL } from "../../../runtime/index.js";
import {
  parseManifest,
  PackageCompiler,
  readInstalledPackages,
  resolveClosure,
  composeClosure,
  dependencyNames,
} from "../index.js";

const PROJECTS = join(dirname(fileURLToPath(import.meta.url)), "../../../../test_projects");

type Src = { uri: string; text: string };
function sources(project: string): Src[]
{
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

const metaDoc = toJSON(check(sources("meta-models/tech-architecture")).model);
const msDoc = toJSON(checkAgainst([metaDoc], sources("libraries/microsoft")).model);
const awsDoc = toJSON(checkAgainst([metaDoc], sources("libraries/aws")).model);

/** Pack the three schema packages into a fresh temp node_modules and return it. */
async function installFixture(): Promise<string>
{
  const nodeModules = join(mkdtempSync(join(tmpdir(), "todl-pm-")), "node_modules");
  const packInto = async (project: string, bases: ReturnType<typeof toJSON>[]): Promise<void> => {
    const m = manifest(project);
    const dir = join(nodeModules, "@pragmatic-tech-ai", m.id as string);
    // Inject the bases the fixture already compiled, instead of resolving from disk.
    await new PackageCompiler({ resolver: { resolve: () => Promise.resolve(bases) } }).compile(join(PROJECTS, project), { outDir: dir });
  };
  await packInto("meta-models/tech-architecture", []);
  await packInto("libraries/microsoft", [metaDoc]);
  await packInto("libraries/aws", [metaDoc]);
  return nodeModules;
}

test("discovers installed packages and resolves the app's closure, deps-first", async () => {
  const nodeModules = await installFixture();
  const packages = readInstalledPackages(nodeModules);
  assert.equal(packages.length, 3, "found all three TODL packages");

  const closure = resolveClosure(packages, dependencyNames(manifest("architectures/test_architecture")));
  assert.equal(closure.metaModels.length, 1);
  assert.equal(closure.libraries.length, 2);
  assert.equal(closure.order[0], "@pragmatic-tech-ai/todl-test-tech-architecture", "meta-model resolved before libraries");

  const graph = composeClosure(closure);
  assert.ok(graph.GetDefinition("tech_architecture.location"), "meta-model concept resolves in the composed graph");
});

test("end-to-end: resolved closure + app model yields the instances", async () => {
  const nodeModules = await installFixture();
  const closure = resolveClosure(readInstalledPackages(nodeModules), dependencyNames(manifest("architectures/test_architecture")));
  const graph = composeClosure(closure);

  const appDoc = toJSON(checkAgainst([metaDoc, msDoc, awsDoc], sources("architectures/test_architecture")).model);
  await TODL.Load(graph, new DocumentSource(appDoc));

  const total = graph.Models.reduce(
    (n, m) => n + m.GetDefinitions().reduce((k, d) => k + m.GetInstances(d).length, 0),
    0,
  );
  assert.equal(graph.Models.length, 1);
  assert.equal(total, 154);
});
