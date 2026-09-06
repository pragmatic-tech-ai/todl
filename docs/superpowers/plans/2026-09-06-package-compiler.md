# PackageCompiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the scattered pack/compile free functions into one class, `PackageCompiler`, that owns the full pipeline — read project → resolve deps (node_modules + registry) → compile → emit the npm layout — behind a single `compile(directory, options)` entry point.

**Architecture:** `PackageCompiler` orchestrates and depends on three injected seams (`ProjectReader`, `BaseResolver`, `SinkFactory`) with node/registry default implementations, so it is unit-testable in-memory. The pure primitive `compilePackage` (core `publish/`) is reused verbatim. The one genuinely new piece of logic is the default `RegistryBaseResolver`, which resolves declared dependencies from `node_modules` first, then fetches any not installed from the registry (transitively). `packProject`/`resolveBases`/`packCommand` free functions are absorbed; `pack.ts` is deleted.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), `tsx --test` + `node:test`/`node:assert` (repo convention), existing `compilePackage`/`toPackageJson`/`deriveClasses`/`resolveClosure`/`readInstalledPackages`/`TarReader`/`NpmRegistry`/`resolveRegistryConfig`.

**Spec:** `docs/superpowers/specs/2026-09-06-package-compiler-design.md`.

## Global Constraints

- **OOP, no free functions** (workspace rule): the new logic is class methods. Module-level `const`/`enum`/`type` declarations are fine.
- **`compilePackage` and the pure primitives are unchanged.** No edits to `src/publish/*`, `package-json.ts`, `reflect.ts`, `resolve.ts`, `node-loader.ts`, `registry/*`. The class calls them.
- **The seam interfaces are injectable; defaults are node/registry.** `PackageCompiler` tests inject fakes (no disk, no network). `RegistryBaseResolver` builds its `NpmRegistry` per call via `resolveRegistryConfig(directory, {scope}, process.env)`, overridable by an injected factory (return `undefined` = offline).
- **Errors, two ways (unchanged behavior):** compile diagnostics come back in the result (`ok:false` + `errors`, nothing written); an architecture manifest and an unresolvable dependency **throw**.
- **Tests** in `src/package-manager/tests/`. **Commits** on branch `feat/package-compiler` from `main`; stage per task; **never `git push`**.

---

### Task 0: Branch

- [ ] **Step 1:** `git -C TODL status -sb` clean on `main`.
- [ ] **Step 2:** `git -C TODL checkout -b feat/package-compiler`
- [ ] **Step 3:** `git -C TODL branch --show-current` → `feat/package-compiler`.

---

### Task 1: `RegistryBaseResolver` (the default `BaseResolver`)

The new logic: resolve a manifest's declared deps transitively into ordered base
documents — installed packages first, registry fetch for the rest.

**Files:**
- Create: `src/package-manager/base-resolver.ts`
- Create: `src/package-manager/tests/base-resolver.test.ts`

**Interfaces:**
- Consumes: `readInstalledPackages` (`node-loader.js`), `resolveClosure`/`dependencyNames`/`type InstalledPackage` (`resolve.js`), `NpmRegistry` (`registry/npm-registry.js`), `TarReader` (`registry/tar-reader.js`), `resolveRegistryConfig` (`registry/config.js`), `type ProjectManifest` (`manifest.js`), `type TodlDocument` (`emit/json.js`).
- Produces: `interface BaseResolver { resolve(directory, manifest, scope): Promise<readonly TodlDocument[]> }`; `type RegistryFactory = (directory: string, scope: string) => NpmRegistry | undefined`; `class RegistryBaseResolver implements BaseResolver`. Consumed by `PackageCompiler` (Task 2) as the default resolver.

- [ ] **Step 1: Write the failing test** — `src/package-manager/tests/base-resolver.test.ts`. Reuse the in-memory `FakeRegistry` transport pattern from `registry/tests/npm-registry.test.ts` (publish a dep's tarball, then resolve fetches it):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NpmRegistry, createTgz, type HttpRequest, type HttpResponse, type HttpTransport } from "../registry/index.js";
import { parseManifest } from "../manifest.js";
import { RegistryBaseResolver } from "../base-resolver.js";

const SCOPE = "@pragmatic-tech-ai";
const enc = new TextEncoder();

/** Minimal in-memory registry (publish → getContent), mirroring npm-registry.test. */
class FakeRegistry implements HttpTransport {
  private readonly packuments = new Map<string, Record<string, unknown>>();
  private readonly tarballs = new Map<string, Uint8Array>();
  request(req: HttpRequest): Promise<HttpResponse> {
    if (req.url.includes("/-/")) {
      const bytes = this.tarballs.get(req.url);
      return Promise.resolve(bytes === undefined ? this.notFound() : { status: 200, headers: {}, body: bytes });
    }
    const key = req.url.slice("https://reg.example".length + 1);
    if (req.method === "PUT") {
      const body = JSON.parse(req.body as string) as { name: string; "dist-tags": Record<string, string>; versions: Record<string, { dist: { tarball: string } }>; _attachments: Record<string, { data: string }> };
      const existing = this.packuments.get(key) ?? { name: body.name, "dist-tags": {}, versions: {} };
      Object.assign(existing["dist-tags"] as object, body["dist-tags"]);
      Object.assign(existing["versions"] as object, body.versions);
      this.packuments.set(key, existing);
      for (const [file, att] of Object.entries(body._attachments)) {
        const v = Object.entries(body.versions).find(([, val]) => val.dist.tarball.endsWith(file));
        if (v) this.tarballs.set(v[1].dist.tarball, new Uint8Array(Buffer.from(att.data, "base64")));
      }
      return Promise.resolve({ status: 201, headers: {}, body: enc.encode("{}") });
    }
    const p = this.packuments.get(key);
    return Promise.resolve(p === undefined ? this.notFound() : { status: 200, headers: {}, body: enc.encode(JSON.stringify(p)) });
  }
  private notFound(): HttpResponse { return { status: 404, headers: {}, body: enc.encode("{}") }; }
}

const REGISTRY = "https://reg.example";
function registry(transport: HttpTransport): NpmRegistry {
  return new NpmRegistry({ registry: REGISTRY, scope: SCOPE, token: "t", transport });
}

/** Publish a TODL package (todl block + model.json) into a fake registry. */
async function publishPkg(reg: NpmRegistry, id: string, deps: Record<string, string>, model: unknown): Promise<void> {
  await reg.publish(
    { name: `${SCOPE}/${id}`, version: "0.1.0", todl: { kind: "library", id }, dependencies: deps } as never,
    createTgz([
      { path: "package/package.json", bytes: enc.encode(JSON.stringify({ name: `${SCOPE}/${id}`, version: "0.1.0", todl: { kind: "library", id }, dependencies: deps })) },
      { path: "package/model.json", bytes: enc.encode(JSON.stringify(model)) },
    ]),
  );
}

/** A library manifest declaring one meta-model dependency (id `meta`). */
const libManifest = () => parseManifest(JSON.stringify({ type: "library", name: "lib", version: 1, id: "lib", libVersion: "0.1.0", metaModel: { id: "meta", version: "0.1.0" } }));

test("resolves an installed dependency offline (no registry hit)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "todl-res-"));
  const depDir = join(dir, "node_modules", SCOPE, "meta");
  mkdirSync(depDir, { recursive: true });
  writeFileSync(join(depDir, "package.json"), JSON.stringify({ name: `${SCOPE}/meta`, todl: { kind: "meta-model", id: "meta" }, dependencies: {} }));
  writeFileSync(join(depDir, "model.json"), JSON.stringify({ nodes: [{ id: "m1" }], edges: [] }));

  const bases = await new RegistryBaseResolver(() => undefined).resolve(dir, libManifest(), SCOPE);
  assert.equal(bases.length, 1);
  assert.deepEqual(bases[0]!.nodes, [{ id: "m1" }]);
});

test("fetches a not-installed dependency from the registry (transitively)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "todl-res-")); // empty node_modules
  const reg = registry(new FakeRegistry());
  await publishPkg(reg, "meta", {}, { nodes: [{ id: "m1" }], edges: [] });

  const bases = await new RegistryBaseResolver(() => reg).resolve(dir, libManifest(), SCOPE);
  assert.equal(bases.length, 1);
  assert.deepEqual(bases[0]!.nodes, [{ id: "m1" }]);
});

test("throws naming a dependency resolvable from neither source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "todl-res-"));
  await assert.rejects(
    new RegistryBaseResolver(() => undefined).resolve(dir, libManifest(), SCOPE),
    /cannot resolve dependency "@pragmatic-tech-ai\/meta"/,
  );
});
```

- [ ] **Step 2: Run RED** — `cd TODL && npx tsx --test src/package-manager/tests/base-resolver.test.ts` → FAIL (`Cannot find module '../base-resolver.js'`).

- [ ] **Step 3: Implement `src/package-manager/base-resolver.ts`:**

```ts
/**
 * Resolve a manifest's declared dependencies (transitively) into ordered base
 * documents (design: package-compiler §3.3). Installed packages (node_modules)
 * are used first; anything not installed is fetched from the registry. The
 * `BaseResolver` seam lets `PackageCompiler` inject a fake in tests.
 */
import { join } from "node:path";
import type { TodlDocument } from "../emit/json.js";
import type { ProjectManifest } from "./manifest.js";
import { readInstalledPackages } from "./node-loader.js";
import { resolveClosure, dependencyNames, type InstalledPackage } from "./resolve.js";
import { NpmRegistry } from "./registry/npm-registry.js";
import { TarReader } from "./registry/tar-reader.js";
import { resolveRegistryConfig } from "./registry/config.js";

/** Resolves declared deps into ordered base documents (deps-first). */
export interface BaseResolver {
  resolve(directory: string, manifest: ProjectManifest, scope: string): Promise<readonly TodlDocument[]>;
}

/** Builds the registry client for a project dir + scope. `undefined` → offline. */
export type RegistryFactory = (directory: string, scope: string) => NpmRegistry | undefined;

export class RegistryBaseResolver implements BaseResolver {
  constructor(private readonly registryFor: RegistryFactory = RegistryBaseResolver.defaultRegistry) {}

  /** Default: a client configured from the project's layered registry config. */
  private static defaultRegistry(directory: string, scope: string): NpmRegistry {
    return new NpmRegistry(resolveRegistryConfig(directory, { scope }, process.env));
  }

  async resolve(directory: string, manifest: ProjectManifest, scope: string): Promise<readonly TodlDocument[]> {
    const installed = new Map<string, InstalledPackage>();
    for (const pkg of readInstalledPackages(join(directory, "node_modules"))) installed.set(pkg.name, pkg);

    const registry = this.registryFor(directory, scope);
    const roots = dependencyNames(manifest, scope);
    const collected: InstalledPackage[] = [];
    const seen = new Set<string>();
    const queue = [...roots];
    while (queue.length > 0) {
      const name = queue.shift() as string;
      if (seen.has(name)) continue;
      seen.add(name);
      let pkg = installed.get(name);
      if (pkg === undefined) {
        pkg = registry === undefined ? undefined : await RegistryBaseResolver.fetch(registry, name);
        if (pkg === undefined) {
          throw new Error(`cannot resolve dependency "${name}" (not installed, not on the registry)`);
        }
      }
      collected.push(pkg);
      for (const dep of pkg.dependencies) if (!seen.has(dep)) queue.push(dep);
    }

    const closure = resolveClosure(collected, roots);
    return [...closure.metaModels, ...closure.libraries];
  }

  /** Fetch + read a package's tarball; `undefined` if absent or not a TODL package. */
  private static async fetch(registry: NpmRegistry, name: string): Promise<InstalledPackage | undefined> {
    try {
      return TarReader.readPackage(await registry.getContent({ name }));
    } catch {
      return undefined; // 404 / transport failure → treated as unresolvable by the caller
    }
  }
}
```

- [ ] **Step 4: Run GREEN** — `npx tsx --test src/package-manager/tests/base-resolver.test.ts` → 3 pass.

- [ ] **Step 5: Commit**
```bash
git add src/package-manager/base-resolver.ts src/package-manager/tests/base-resolver.test.ts
git commit -m "feat(package-manager): RegistryBaseResolver (node_modules + registry fetch)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `PackageCompiler`

The class: read → resolve → compile → emit, behind one `compile()`.

**Files:**
- Create: `src/package-manager/package-compiler.ts`
- Create: `src/package-manager/tests/package-compiler.test.ts`

**Interfaces:**
- Consumes: `compilePackage`/`PackageKind`/`type PackageRef`/`type PackageIdentity`/`type CompiledPackage` (`publish/publish.js`), `type PackageSink` (`publish/stores.js`), `FileSink` (`sinks.js`), `readProject`/`type Project` (`project.js`), `type ProjectManifest` (`manifest.js`), `toPackageJson`/`DEFAULT_SCOPE`/`type TodlPackageMeta` (`package-json.js`), `RegistryBaseResolver`/`type BaseResolver` (`base-resolver.js`), `type TodlDocument` (`emit/json.js`), `type Diagnostic` (`diagnostics/diagnostic.js`).
- Produces: `interface ProjectReader`, `class NodeProjectReader`, `type SinkFactory`, `interface CompileOptions`, `interface CompileResult`, `interface PackageCompilerDeps`, `class PackageCompiler`. Consumed by `commands.ts`/`cli.ts` (Task 3).

- [ ] **Step 1: Write the failing test** — `src/package-manager/tests/package-compiler.test.ts` (injected fakes; no disk, no network):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { check } from "../../api.js";
import { toJSON } from "../../emit/json.js";
import { parseManifest, MemorySink, type Project } from "../index.js";
import { PackageCompiler, type ProjectReader, type BaseResolver } from "../index.js";
import type { TodlDocument } from "../../emit/json.js";

const PROJECTS = join(dirname(fileURLToPath(import.meta.url)), "../../../test_projects");
type Src = { uri: string; text: string };
function sources(project: string): Src[] {
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
function reader(project: Project): ProjectReader { return { read: () => project }; }
/** A resolver returning fixed bases (dependency resolution, faked). */
function resolver(bases: readonly TodlDocument[]): BaseResolver { return { resolve: () => Promise.resolve(bases) }; }

const metaDoc = toJSON(check(sources("meta-models/tech-architecture")).model);

test("compiles a meta-model into the npm package layout", async () => {
  const sink = new MemorySink();
  const project: Project = { directory: "/x", manifest: manifest("meta-models/tech-architecture"), sources: sources("meta-models/tech-architecture") };
  const compiler = new PackageCompiler({ reader: reader(project), resolver: resolver([]), createSink: () => sink });

  const result = await compiler.compile("/x");
  assert.ok(result.ok, result.errors.map((e) => e.message).join(", "));
  for (const f of ["package.json", "model.json", "index.js", "index.d.ts"]) assert.ok(sink.files.has(f), `wrote ${f}`);
  assert.ok([...sink.files.keys()].some((p) => p.startsWith("src/")), "wrote src/");
  const pkg = JSON.parse(sink.files.get("package.json") as string);
  assert.deepEqual(pkg.todl, { kind: "meta-model", id: "todl-test-tech-architecture" });
  assert.match(sink.files.get("index.js") as string, /export const document =/);
  assert.ok(result.package, "returns the in-memory package");
});

test("compiles a library against injected bases + records the dep", async () => {
  const sink = new MemorySink();
  const project: Project = { directory: "/x", manifest: manifest("libraries/microsoft"), sources: sources("libraries/microsoft") };
  const compiler = new PackageCompiler({ reader: reader(project), resolver: resolver([metaDoc]), createSink: () => sink });

  const result = await compiler.compile("/x");
  assert.ok(result.ok, result.errors.map((e) => e.message).join(", "));
  const pkg = JSON.parse(sink.files.get("package.json") as string);
  assert.deepEqual(pkg.dependencies, { "@pragmatic-tech-ai/todl-test-tech-architecture": "0.1.0" });
});

test("a failing compile writes nothing and returns errors", async () => {
  const sink = new MemorySink();
  const bad: Project = { directory: "/x", manifest: manifest("meta-models/tech-architecture"), sources: [{ uri: "bad.todl", text: "element Broken : DoesNotExist;\n" }] };
  const compiler = new PackageCompiler({ reader: reader(bad), resolver: resolver([]), createSink: () => sink });

  const result = await compiler.compile("/x");
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0, "surfaces errors");
  assert.equal(sink.files.size, 0, "sink untouched on failure");
});

test("refuses to compile an architecture (not published)", async () => {
  const project: Project = { directory: "/x", manifest: manifest("architectures/test_architecture"), sources: [] };
  const compiler = new PackageCompiler({ reader: reader(project), resolver: resolver([]), createSink: () => new MemorySink() });
  await assert.rejects(compiler.compile("/x"), /not published/);
});
```

- [ ] **Step 2: Run RED** — `npx tsx --test src/package-manager/tests/package-compiler.test.ts` → FAIL (module/exports missing). (Depends on the Task 3 `index.ts` re-exports for `PackageCompiler`/`ProjectReader`/`BaseResolver`/`Project` — if running this task in isolation, import directly from `../package-compiler.js`/`../base-resolver.js`/`../project.js`; Step 3 + Task 3 make the `index.js` imports resolve.)

- [ ] **Step 3: Implement `src/package-manager/package-compiler.ts`:**

```ts
/**
 * `PackageCompiler` — the full pack pipeline as one class (design:
 * package-compiler): read a project directory, resolve its declared dependencies
 * into base documents, compile against them (the pure `compilePackage`), and emit
 * the npm package layout through a sink. I/O and dependency resolution are
 * injected seams (node/registry defaults) so the class is unit-testable.
 */
import { join } from "node:path";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { TodlDocument } from "../emit/json.js";
import {
  compilePackage,
  PackageKind,
  type PackageRef,
  type PackageIdentity,
  type CompiledPackage,
} from "../publish/publish.js";
import type { PackageSink } from "../publish/stores.js";
import { FileSink } from "./sinks.js";
import { readProject, type Project } from "./project.js";
import type { ProjectManifest } from "./manifest.js";
import { toPackageJson, DEFAULT_SCOPE, type PackageJson, type TodlPackageMeta } from "./package-json.js";
import { RegistryBaseResolver, type BaseResolver } from "./base-resolver.js";

/** Reads a project directory → manifest + .todl sources. */
export interface ProjectReader {
  read(directory: string): Project;
}

/** The default reader: node:fs, via the existing `readProject`. */
export class NodeProjectReader implements ProjectReader {
  read(directory: string): Project {
    return readProject(directory);
  }
}

/** Makes the output sink for a directory. */
export type SinkFactory = (outDir: string) => PackageSink;

export interface CompileOptions {
  /** npm scope override. Default: DEFAULT_SCOPE. */
  scope?: string;
  /** Output directory. Default: `<directory>/dist`. */
  outDir?: string;
}

export interface CompileResult {
  ok: boolean;
  diagnostics: readonly Diagnostic[];
  errors: readonly Diagnostic[];
  /** Package-relative paths written — present iff `ok`. */
  files?: string[];
  /** The in-memory compiled package — present iff `ok`. */
  package?: CompiledPackage;
}

export interface PackageCompilerDeps {
  reader?: ProjectReader;
  resolver?: BaseResolver;
  createSink?: SinkFactory;
}

export class PackageCompiler {
  private readonly reader: ProjectReader;
  private readonly resolver: BaseResolver;
  private readonly createSink: SinkFactory;

  constructor(deps: PackageCompilerDeps = {}) {
    this.reader = deps.reader ?? new NodeProjectReader();
    this.resolver = deps.resolver ?? new RegistryBaseResolver();
    this.createSink = deps.createSink ?? ((dir) => new FileSink(dir));
  }

  /** Read → resolve deps → compile → emit. Writes nothing on a failing compile.
   *  Throws for an architecture manifest and for an unresolvable dependency. */
  async compile(directory: string, options: CompileOptions = {}): Promise<CompileResult> {
    const project = this.reader.read(directory);
    const scope = options.scope ?? DEFAULT_SCOPE;
    const packageJson = toPackageJson(project.manifest, { scope }); // throws on an architecture
    const bases = await this.resolver.resolve(directory, project.manifest, scope);

    const identity: PackageIdentity = { id: packageJson.todl.id, version: packageJson.version, name: project.manifest.name };
    const outcome = compilePackage(bases, project.sources, identity, this.dependencyRefs(project.manifest));
    if (!outcome.ok || outcome.package === undefined) {
      return { ok: false, diagnostics: outcome.diagnostics, errors: outcome.errors };
    }

    const sink = this.createSink(options.outDir ?? join(directory, "dist"));
    const files = await this.emit(sink, outcome.package, packageJson);
    return { ok: true, diagnostics: outcome.diagnostics, errors: outcome.errors, files, package: outcome.package };
  }

  /** The pinned dependency refs a manifest declares, as `PackageRef`s. */
  private dependencyRefs(manifest: ProjectManifest): PackageRef[] {
    const refs: PackageRef[] = [];
    if (manifest.metaModel !== undefined) {
      refs.push({ kind: PackageKind.MetaModel, id: manifest.metaModel.id, version: manifest.metaModel.version });
    }
    for (const library of manifest.libraries ?? []) {
      refs.push({ kind: PackageKind.Library, id: library.id, version: library.version });
    }
    return refs;
  }

  /** Write the npm package layout, returning the package-relative paths written. */
  private async emit(sink: PackageSink, pkg: CompiledPackage, packageJson: PackageJson): Promise<string[]> {
    const files: string[] = [];
    const write = async (path: string, content: string): Promise<void> => {
      await sink.writeText(path, content);
      files.push(path);
    };
    await write("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
    await write("model.json", `${JSON.stringify(pkg.document, null, 2)}\n`);
    for (const source of pkg.sources) await write(`src/${source.uri}`, source.text);
    await write("index.js", PackageCompiler.handleModule(pkg.document, packageJson.todl));
    await write("index.d.ts", PackageCompiler.handleTypes());
    return files;
  }

  /** The embedded handle module: the compiled `model.json` inlined as a
   *  browser-safe ES module (importing the package yields its document, no I/O). */
  private static handleModule(document: TodlDocument, meta: TodlPackageMeta): string {
    return [
      "// Generated TODL package handle. The compiled model.json is inlined so that",
      "// importing this package yields its document with no I/O (browser-safe).",
      `export const document = ${JSON.stringify(document)};`,
      `export const meta = ${JSON.stringify(meta)};`,
      "export default document;",
      "",
    ].join("\n");
  }

  /** Types for the handle module (the richer typed-class bridge is a later increment). */
  private static handleTypes(): string {
    return [
      "export declare const document: unknown;",
      "export declare const meta: { kind: string; id: string };",
      "declare const _default: unknown;",
      "export default _default;",
      "",
    ].join("\n");
  }
}
```

Note: `PackageJson` is exported from `package-json.ts` (add it to the import). If it is not currently exported, export it there (type only).

- [ ] **Step 4: Run GREEN** — after Task 3's `index.ts` re-exports land (or importing directly from the module files), `npx tsx --test src/package-manager/tests/package-compiler.test.ts` → 4 pass. (If sequencing strictly, temporarily import from `../package-compiler.js`/`../base-resolver.js`/`../project.js` in the test, then switch to `../index.js` after Task 3.)

- [ ] **Step 5: Commit**
```bash
git add src/package-manager/package-compiler.ts src/package-manager/tests/package-compiler.test.ts
git commit -m "feat(package-manager): PackageCompiler — read/resolve/compile/emit pipeline" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Absorb `packProject`/`resolveBases`/`packCommand`; retarget exports, CLI, tests

Wire the class in and remove the free functions it replaced.

**Files:**
- Modify: `src/package-manager/commands.ts` (packCommand → PackageCompiler; remove resolveBases; publishCommand unchanged in behavior)
- Modify: `src/package-manager/index.ts` (drop `packProject`/`PackInput`/`PackResult`; add the new exports)
- Delete: `src/package-manager/pack.ts`, `src/package-manager/tests/pack.test.ts` (replaced by `package-compiler.test.ts`)
- Modify: `src/package-manager/tests/commands.test.ts` (setup + import retarget)
- Modify: `src/package-manager/package-json.ts` (export `PackageJson` type if not already) — verify only.

**Interfaces:** `packCommand(directory, options): Promise<CompileResult>` (return type renamed from `PackResult`; same shape + optional `package`). `publishCommand` unchanged signature.

- [ ] **Step 1: `commands.ts`** — replace the `packProject`/`resolveBases` imports + `packCommand`/`resolveBases`:
  - Remove imports of `packProject`, `type PackResult`, `readInstalledPackages`, `resolveClosure`, `dependencyNames`, `FileSink` (FileSink no longer needed here), and the `resolveBases` function.
  - Add `import { PackageCompiler, type CompileResult } from "./package-compiler.js";`
  - Rewrite `packCommand`:

```ts
/** Compile a project against its installed/registry deps and write its npm layout. */
export function packCommand(directory: string, options: PackOptions = {}): Promise<CompileResult> {
  return new PackageCompiler().compile(directory, options);
}
```

  - `publishCommand` stays, but its `packCommand(...)` call now returns `CompileResult` (same `.ok`/`.errors`); no change needed beyond the type flowing through. Keep the `outDir` it passes.

- [ ] **Step 2: `index.ts`** — remove the pack export line and add the new ones:
  - Delete: `export { packProject, type PackInput, type PackResult } from "./pack.js";`
  - Add:

```ts
export {
  PackageCompiler,
  NodeProjectReader,
  type ProjectReader,
  type SinkFactory,
  type CompileOptions,
  type CompileResult,
  type PackageCompilerDeps,
} from "./package-compiler.js";
export { RegistryBaseResolver, type BaseResolver, type RegistryFactory } from "./base-resolver.js";
export { readProject, type Project } from "./project.js";  // (already exported — keep)
```

  (Ensure `readProject`/`Project` remain exported — they already are; do not duplicate.)

- [ ] **Step 3: Delete the replaced files** — `git rm src/package-manager/pack.ts src/package-manager/tests/pack.test.ts`.

- [ ] **Step 4: `commands.test.ts`** — retarget the setup helper + import (it used `packProject`/`FileSink` to install a dep):
  - Change the import to `import { parseManifest, PackageCompiler, packCommand } from "../index.js";`
  - Replace the dep-install in `setupLibraryProject` (which packed the meta-model into `node_modules/<scope>/…`) with a `PackageCompiler().compile` of the real meta-model project directory into that location:

```ts
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
```

  The two `packCommand(...)` assertions below are unchanged (they read `dist/package.json` etc.).

- [ ] **Step 5: `package-json.ts` export check** — confirm `PackageJson` is exported (it is, per `index.ts`'s existing `type PackageJson` re-export). If `package-compiler.ts` imports it and tsc/tsx complains, add `export` to the interface. No behavior change.

- [ ] **Step 6: Full suite GREEN** — `npx tsx --test "src/package-manager/**/*.test.ts"` → all pass (base-resolver, package-compiler, commands, package-json, resolve). Then a broad check: `npm test` (full core) stays green, and `npx tsx --conditions=development cli/src/main.ts` is unaffected. Also confirm nothing else imports the deleted `pack.js`: `grep -rn "from \"\./pack\.js\"\|packProject\|PackInput\|PackResult" src cli app 2>/dev/null` returns nothing (or only historical comments).

- [ ] **Step 7: Commit**
```bash
git add src/package-manager/commands.ts src/package-manager/index.ts src/package-manager/tests/commands.test.ts
git rm src/package-manager/pack.ts src/package-manager/tests/pack.test.ts
git commit -m "refactor(package-manager): route pack through PackageCompiler; drop pack.ts" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:** single class + one `compile()` entry (Task 2) ✓ · three injected seams with node/registry defaults (Tasks 1–2) ✓ · registry-fetch `RegistryBaseResolver` (Task 1) ✓ · reuse `compilePackage`/`toPackageJson`/`deriveClasses` unchanged (Task 2 imports; no edits to core) ✓ · absorb `packProject`/`resolveBases`/`packCommand`, delete `pack.ts` (Task 3) ✓ · errors two ways — diagnostics in result vs throw on architecture/unresolvable (Tasks 1–2 tested) ✓ · publishing stays external (`publishCommand` unchanged) ✓.

**2. Placeholder scan:** full code for both new files + tests; Task 3 gives exact edits. No TBD. The only conditional is the `PackageJson` export check (Step 5), which is a verify-not-change.

**3. Type/name consistency:** `BaseResolver` defined in `base-resolver.ts`, type-imported by `package-compiler.ts` (one runtime direction: package-compiler → base-resolver; no cycle). `CompileResult` replaces `PackResult` in `commands.ts`/CLI (same shape + optional `package`; `cli.ts` uses `result.ok`/`result.errors`/`result.files?.length` — all present). `RegistryFactory` return `NpmRegistry | undefined` matches `RegistryBaseResolver` ctor default + the offline test (`() => undefined`). `dependencyRefs`/`handleModule`/`handleTypes` moved verbatim from `pack.ts` into `PackageCompiler` privates. `resolveClosure(collected, roots)` + `dependencyNames(manifest, scope)` signatures match `resolve.ts`. Scope threaded consistently: `options.scope ?? DEFAULT_SCOPE` → both `toPackageJson({scope})` and `resolver.resolve(…, scope)`.
