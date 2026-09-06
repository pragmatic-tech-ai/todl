# PackageManager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a single registry-facing `PackageManager` class (plus a tiny `ProjectInstaller`), collapse the `commands.ts` free functions into them, and make the CLI and the app's `RegistryBridge` delegate — removing the duplicated closure BFS.

**Architecture:** `PackageManager` owns an `NpmRegistry` and exposes the registry/published-package surface (`list`, `versions`, `manifestKind`, `getContent`, `getPackage`, `getSources`, `resolveClosure`, `publish`, `get`). It never reads a project directory and never touches the compiler. `PackageCompiler` (project → compiled package) and `ProjectInstaller` (`npm install`) own directory work. `cli.ts` orchestrates all three. The app's `RegistryBridge` becomes an app-config/IPC adapter over an injected `createManager(config)` factory, keeping its package-manager imports type-only.

**Tech Stack:** TypeScript (ESM, `"type":"module"`), `tsx --test` + `node:test`/`node:assert`. No new deps.

**Spec:** `docs/superpowers/specs/2026-09-06-package-manager-design.md`

## Global Constraints

- **OOP, no free functions/module-level state.** New behavior lives on classes as methods (static where it has no instance state). The one exception is `cli.ts`, an existing executable entry that already uses module-level `parseArgs`/`main` — leave that structure as-is; only change command bodies. Do not OOP-ify the CLI in this plan.
- **Enums over string literals.** Reuse existing enums (`ProjectType`, `TokenSource`); introduce no string-literal unions.
- **Tests in `tests/` subfolders** next to the source (`src/package-manager/tests/`, `app/src/main/registry/tests/`).
- **The app's `RegistryBridge` imports package-manager symbols type-only.** Only `app/src/main/index.ts` may runtime-import package-manager. Preserve this — it's why `tsx` needs no bundler alias.
- **Do not change** `PackageCompiler`, `NpmRegistry`, `RegistryBaseResolver`, the wire protocol, IPC channel names, or the preload/renderer surface.
- **Commit messages** end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Run suites from the `TODL/` directory. Never `--no-verify`.

## File Structure

- Create `src/package-manager/package-manager.ts` — the `PackageManager` class + `PackageSource` interface.
- Create `src/package-manager/project-installer.ts` — `ProjectInstaller` + `NpmRunner` seam.
- Create `src/package-manager/tests/package-manager.test.ts` — full method coverage against a fake transport.
- Create `src/package-manager/tests/project-installer.test.ts` — fake-runner coverage.
- Modify `src/package-manager/index.ts` — export the new symbols; drop the `commands.ts` exports.
- Modify `src/package-manager/cli.ts` — orchestrate `PackageCompiler` + `PackageManager` + `ProjectInstaller` directly.
- Delete `src/package-manager/commands.ts`.
- Rename `src/package-manager/tests/commands.test.ts` → `src/package-manager/tests/compiler-integration.test.ts`, retargeted onto `PackageCompiler`.
- Modify `app/src/main/registry/registry-bridge.ts` — shrink deps to a `createManager` factory; delegate; type-import `PackageSource` from core.
- Modify `app/src/main/registry/tests/registry-bridge.test.ts` — inject a fake `PackageManagerLike`.
- Modify `app/src/main/index.ts` — wire `createManager: (c) => new PackageManager(c)`.

`app/src/main/registry/register-ipc.ts` and the preload/renderer are **unchanged**: the bridge keeps its existing public method names (`getMeta`, `publishDir`, …); only their bodies change.

---

### Task 1: `ProjectInstaller`

**Files:**
- Create: `src/package-manager/project-installer.ts`
- Test: `src/package-manager/tests/project-installer.test.ts`

**Interfaces:**
- Consumes: `runNpm(args: readonly string[], cwd: string): Promise<number>` from `./npm.js`.
- Produces:
  ```ts
  export type NpmRunner = (args: readonly string[], cwd: string) => Promise<number>;
  export class ProjectInstaller {
    constructor(run?: NpmRunner);              // default: runNpm
    install(directory: string): Promise<number>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/package-manager/tests/project-installer.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectInstaller } from "../project-installer.js";

test("install runs `npm install` in the given directory", async () => {
  const calls: { args: readonly string[]; cwd: string }[] = [];
  const runner = (args: readonly string[], cwd: string) => {
    calls.push({ args, cwd });
    return Promise.resolve(0);
  };
  const code = await new ProjectInstaller(runner).install("/proj");
  assert.equal(code, 0);
  assert.deepEqual(calls, [{ args: ["install"], cwd: "/proj" }]);
});

test("install propagates npm's non-zero exit code", async () => {
  const code = await new ProjectInstaller(() => Promise.resolve(1)).install("/proj");
  assert.equal(code, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL && npx tsx --test src/package-manager/tests/project-installer.test.ts`
Expected: FAIL — cannot find module `../project-installer.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/package-manager/project-installer.ts`:

```ts
/**
 * `ProjectInstaller` — installs a project's declared dependencies into its
 * node_modules (design: package-manager). A thin wrapper over `npm install`:
 * building a transitive dependency tree is npm's job, not the single-tarball
 * registry client's. The npm runner is an injected seam so the class unit-tests
 * without spawning npm.
 */
import { runNpm } from "./npm.js";

/** Runs npm with `args` in `cwd`, resolving with npm's exit code. */
export type NpmRunner = (args: readonly string[], cwd: string) => Promise<number>;

export class ProjectInstaller {
  private readonly run: NpmRunner;
  constructor(run: NpmRunner = runNpm) {
    this.run = run;
  }

  /** Install `directory`'s dependencies (delegates to `npm install`). */
  install(directory: string): Promise<number> {
    return this.run(["install"], directory);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL && npx tsx --test src/package-manager/tests/project-installer.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL
git add src/package-manager/project-installer.ts src/package-manager/tests/project-installer.test.ts
git commit -m "feat: ProjectInstaller wrapping npm install

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `PackageManager`

**Files:**
- Create: `src/package-manager/package-manager.ts`
- Test: `src/package-manager/tests/package-manager.test.ts`

**Interfaces:**
- Consumes:
  - `NpmRegistry` + `type NpmRegistryConfig`, `type PackageRef`, `type VersionList` from `./registry/npm-registry.js`.
  - `TarReader` from `./registry/tar-reader.js` (`static read(bytes): TarFile[]`, `static readPackage(bytes): InstalledPackage | undefined`).
  - `resolveClosure(packages, rootDeps): ResolvedClosure`, `type InstalledPackage`, `type ResolvedClosure` from `./resolve.js`.
  - `writeFileSync` from `node:fs`.
- Produces:
  ```ts
  export interface PackageSource { name: string; text: string; }
  export class PackageManager {
    constructor(config: NpmRegistryConfig);
    list(): Promise<string[]>;
    versions(name: string): Promise<VersionList>;
    manifestKind(name: string): Promise<string>;
    getContent(ref: PackageRef): Promise<Uint8Array>;
    getPackage(ref: PackageRef): Promise<InstalledPackage>;
    getSources(ref: PackageRef): Promise<PackageSource[]>;
    resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure>;
    publish(compiledDir: string): Promise<void>;
    get(refInput: string, outFile?: string): Promise<string>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/package-manager/tests/package-manager.test.ts`. It reuses the in-memory registry pattern from `registry/tests/npm-registry.test.ts` — a `FakeRegistry implements HttpTransport` — and drives `PackageManager` through it end to end:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PackageManager } from "../package-manager.js";
import { NpmRegistry, createTgz, type HttpRequest, type HttpResponse, type HttpTransport } from "../registry/index.js";

const REGISTRY = "https://npm.example";
const GITHUB = "https://api.example";
const SCOPE = "@pragmatic-tech-ai";
const enc = new TextEncoder();

/** An in-memory npm registry + GitHub Packages API (same 4 routes the client speaks). */
class FakeRegistry implements HttpTransport {
  private readonly packuments = new Map<string, Record<string, unknown>>();
  private readonly tarballs = new Map<string, Uint8Array>();
  private readonly packageNames = new Set<string>();

  request(req: HttpRequest): Promise<HttpResponse> {
    if (req.url.startsWith(`${GITHUB}/orgs/`)) return Promise.resolve(this.json([...this.packageNames].map((name) => ({ name }))));
    if (req.url.includes("/-/")) {
      const bytes = this.tarballs.get(req.url);
      return Promise.resolve(bytes === undefined ? this.json({ error: "nf" }, 404) : { status: 200, headers: {}, body: bytes });
    }
    const key = req.url.slice(REGISTRY.length + 1);
    if (req.method === "PUT") return Promise.resolve(this.put(key, req));
    const packument = this.packuments.get(key);
    return Promise.resolve(packument === undefined ? this.json({ error: "nf" }, 404) : this.json(packument));
  }
  private put(key: string, req: HttpRequest): HttpResponse {
    const body = JSON.parse(req.body as string) as {
      name: string; "dist-tags": Record<string, string>;
      versions: Record<string, { dist: { tarball: string } }>;
      _attachments: Record<string, { data: string }>;
    };
    const existing = this.packuments.get(key) ?? { name: body.name, "dist-tags": {}, versions: {} };
    Object.assign(existing["dist-tags"] as object, body["dist-tags"]);
    Object.assign(existing["versions"] as object, body.versions);
    this.packuments.set(key, existing);
    for (const [file, att] of Object.entries(body._attachments)) {
      const v = Object.entries(body.versions).find(([, ver]) => ver.dist.tarball.endsWith(file));
      if (v !== undefined) this.tarballs.set(v[1].dist.tarball, new Uint8Array(Buffer.from(att.data, "base64")));
    }
    const slash = body.name.indexOf("/");
    this.packageNames.add(slash < 0 ? body.name : body.name.slice(slash + 1));
    return { status: 201, headers: {}, body: enc.encode("{}") };
  }
  private json(value: unknown, status = 200): HttpResponse {
    return { status, headers: {}, body: enc.encode(JSON.stringify(value)) };
  }
}

/** Publish a compiled TODL package (package.json incl. todl + deps, model.json, src/**). */
async function publishPackage(
  registry: NpmRegistry,
  id: string,
  version: string,
  todl: { kind: string; id: string },
  deps: Record<string, string> = {},
  src: Record<string, string> = {},
): Promise<void> {
  const files = [
    { path: "package/package.json", bytes: enc.encode(JSON.stringify({ name: `${SCOPE}/${id}`, version, todl, dependencies: deps })) },
    { path: "package/model.json", bytes: enc.encode(JSON.stringify({ nodes: [] })) },
    ...Object.entries(src).map(([name, text]) => ({ path: `package/src/${name}`, bytes: enc.encode(text) })),
  ];
  await registry.publish({ name: `${SCOPE}/${id}`, version } as never, createTgz(files));
}

function manager(transport: HttpTransport): PackageManager {
  return new PackageManager({ registry: REGISTRY, scope: SCOPE, token: "t", githubApi: GITHUB, transport });
}

test("list and versions report published packages", async () => {
  const fake = new FakeRegistry();
  const seed = new NpmRegistry({ registry: REGISTRY, scope: SCOPE, token: "t", githubApi: GITHUB, transport: fake });
  await publishPackage(seed, "aws", "0.1.0", { kind: "library", id: "aws" });
  await publishPackage(seed, "aws", "0.2.0", { kind: "library", id: "aws" });
  await publishPackage(seed, "microsoft", "0.1.0", { kind: "library", id: "microsoft" });

  const pm = manager(fake);
  assert.deepEqual((await pm.list()).sort(), ["aws", "microsoft"]);
  const versions = await pm.versions("aws");
  assert.deepEqual(versions.versions.sort(), ["0.1.0", "0.2.0"]);
  assert.equal(versions.distTags["latest"], "0.2.0");
});

test("manifestKind returns the todl kind, empty string when absent", async () => {
  const fake = new FakeRegistry();
  const seed = new NpmRegistry({ registry: REGISTRY, scope: SCOPE, token: "t", githubApi: GITHUB, transport: fake });
  await publishPackage(seed, "aws", "0.1.0", { kind: "library", id: "aws" });
  // A non-TODL npm package: publish a version with no todl block.
  await seed.publish({ name: `${SCOPE}/plain`, version: "1.0.0" } as never, createTgz([{ path: "package/package.json", bytes: enc.encode(JSON.stringify({ name: `${SCOPE}/plain`, version: "1.0.0" })) }]));

  const pm = manager(fake);
  assert.equal(await pm.manifestKind("aws"), "library");
  assert.equal(await pm.manifestKind("plain"), "");
});

test("getPackage parses a compiled package; throws for a non-TODL tarball", async () => {
  const fake = new FakeRegistry();
  const seed = new NpmRegistry({ registry: REGISTRY, scope: SCOPE, token: "t", githubApi: GITHUB, transport: fake });
  await publishPackage(seed, "aws", "0.1.0", { kind: "library", id: "aws" });
  await seed.publish({ name: `${SCOPE}/plain`, version: "1.0.0" } as never, createTgz([{ path: "package/readme", bytes: enc.encode("hi") }]));

  const pm = manager(fake);
  const pkg = await pm.getPackage({ name: "aws" });
  assert.equal(pkg.name, `${SCOPE}/aws`);
  assert.equal(pkg.meta.kind, "library");
  await assert.rejects(pm.getPackage({ name: "plain" }), /not a TODL package/);
});

test("getSources returns only package/src files, stripped to their uri", async () => {
  const fake = new FakeRegistry();
  const seed = new NpmRegistry({ registry: REGISTRY, scope: SCOPE, token: "t", githubApi: GITHUB, transport: fake });
  await publishPackage(seed, "aws", "0.1.0", { kind: "library", id: "aws" }, {}, {
    "aws.todl": "concept EC2;\n",
    "nested/more.todl": "concept S3;\n",
  });

  const sources = await manager(fake).getSources({ name: "aws" });
  assert.deepEqual(sources, [
    { name: "aws.todl", text: "concept EC2;\n" },
    { name: "nested/more.todl", text: "concept S3;\n" },
  ]);
});

test("resolveClosure BFS-fetches transitive deps then orders deps-first", async () => {
  const fake = new FakeRegistry();
  const seed = new NpmRegistry({ registry: REGISTRY, scope: SCOPE, token: "t", githubApi: GITHUB, transport: fake });
  await publishPackage(seed, "tech-architecture", "0.1.0", { kind: "meta-model", id: "tech-architecture" });
  await publishPackage(seed, "aws", "0.1.0", { kind: "library", id: "aws" }, { [`${SCOPE}/tech-architecture`]: "0.1.0" });

  const closure = await manager(fake).resolveClosure([`${SCOPE}/aws`]);
  assert.deepEqual(closure.order, [`${SCOPE}/tech-architecture`, `${SCOPE}/aws`]);
  assert.equal(closure.metaModels.length, 1);
  assert.equal(closure.libraries.length, 1);
});

test("get downloads a published tarball to a default filename", async () => {
  const fake = new FakeRegistry();
  const seed = new NpmRegistry({ registry: REGISTRY, scope: SCOPE, token: "t", githubApi: GITHUB, transport: fake });
  await publishPackage(seed, "aws", "0.1.0", { kind: "library", id: "aws" });

  const dir = mkdtempSync(join(tmpdir(), "todl-get-"));
  const out = join(dir, "aws.tgz");
  const written = await manager(fake).get("aws@0.1.0", out);
  assert.equal(written, out);
  assert.ok(existsSync(out));
  // The bytes are a valid gzip tarball containing the package.
  assert.match(new TextDecoder().decode(gunzipSync(readFileSync(out))), /package\/package\.json/);
});

test("publish PUTs an already-compiled directory", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "todl-pub-")), "dist");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `${SCOPE}/aws`, version: "0.1.0", todl: { kind: "library", id: "aws" } }));
  writeFileSync(join(dir, "model.json"), JSON.stringify({ nodes: [] }));
  writeFileSync(join(dir, "src", "aws.todl"), "concept EC2;\n");

  const fake = new FakeRegistry();
  await manager(fake).publish(dir);
  // Round-trips: the published package is now fetchable + parseable.
  const pkg = await manager(fake).getPackage({ name: "aws", version: "0.1.0" });
  assert.equal(pkg.name, `${SCOPE}/aws`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL && npx tsx --test src/package-manager/tests/package-manager.test.ts`
Expected: FAIL — cannot find module `../package-manager.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/package-manager/package-manager.ts`:

```ts
/**
 * `PackageManager` — the registry-facing package surface as one class (design:
 * package-manager). It owns an `NpmRegistry` and speaks only in registry refs,
 * compiled packages, and published packages: listing, version/kind queries,
 * fetching package content/sources, resolving a published dependency closure,
 * publishing an already-compiled directory, and downloading a tarball. It never
 * reads a project directory and never invokes the compiler — that is
 * `PackageCompiler`'s (and `ProjectInstaller`'s) territory.
 */
import { writeFileSync } from "node:fs";
import { NpmRegistry, type NpmRegistryConfig, type PackageRef, type VersionList } from "./registry/npm-registry.js";
import { TarReader } from "./registry/tar-reader.js";
import { resolveClosure, type InstalledPackage, type ResolvedClosure } from "./resolve.js";

/** One authored source file recovered from a published package tarball. */
export interface PackageSource {
  name: string;   // path under package/src/
  text: string;
}

const SRC_PREFIX = "package/src/";
const decoder = new TextDecoder();

export class PackageManager {
  private readonly registry: NpmRegistry;

  constructor(config: NpmRegistryConfig) {
    this.registry = new NpmRegistry(config);
  }

  /** Every package name published under the configured org. */
  list(): Promise<string[]> {
    return this.registry.listPackages();
  }

  /** A package's published versions + dist-tags. */
  versions(name: string): Promise<VersionList> {
    return this.registry.listVersions(name);
  }

  /** The package's declared TODL kind, or "" if it carries no todl block. */
  async manifestKind(name: string): Promise<string> {
    const manifest = await this.registry.getManifest({ name });
    return manifest.todl?.kind ?? "";
  }

  /** Raw tarball bytes for a ref. */
  getContent(ref: PackageRef): Promise<Uint8Array> {
    return this.registry.getContent(ref);
  }

  /** A compiled package parsed from its tarball. Throws if not a TODL package. */
  async getPackage(ref: PackageRef): Promise<InstalledPackage> {
    const pkg = TarReader.readPackage(await this.registry.getContent(ref));
    if (pkg === undefined) throw new Error(`${ref.name} is not a TODL package`);
    return pkg;
  }

  /** The authored src/** of a published package. */
  async getSources(ref: PackageRef): Promise<PackageSource[]> {
    return TarReader.read(await this.registry.getContent(ref))
      .filter((f) => f.path.startsWith(SRC_PREFIX))
      .map((f) => ({ name: f.path.slice(SRC_PREFIX.length), text: decoder.decode(f.bytes) }));
  }

  /** Registry-only BFS over published packages: fetch each root dep and its
   *  transitive TODL deps, then resolve the closure deps-first. Non-TODL deps
   *  are ignored (a failed tarball fetch propagates). */
  async resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure> {
    const collected: InstalledPackage[] = [];
    const seen = new Set<string>();
    const queue = [...rootDeps];
    while (queue.length > 0) {
      const name = queue.shift() as string;
      if (seen.has(name)) continue;
      seen.add(name);
      const pkg = TarReader.readPackage(await this.registry.getContent({ name }));
      if (pkg === undefined) continue; // a non-TODL npm dependency; ignore
      collected.push(pkg);
      for (const dep of pkg.dependencies) if (!seen.has(dep)) queue.push(dep);
    }
    return resolveClosure(collected, rootDeps);
  }

  /** Publish an ALREADY-compiled package directory (registry PUT). */
  publish(compiledDir: string): Promise<void> {
    return this.registry.publishDir(compiledDir);
  }

  /** Download a published tarball. Writes to `outFile`, or a default
   *  `<unscoped-name>-<version|latest>.tgz` in the cwd. Returns the path written. */
  async get(refInput: string, outFile?: string): Promise<string> {
    const ref = PackageManager.parseRef(refInput);
    const bytes = await this.registry.getContent(ref);
    const file = outFile ?? `${PackageManager.unscoped(ref.name)}-${ref.version ?? "latest"}.tgz`;
    writeFileSync(file, bytes);
    return file;
  }

  /** Split a `name` or `name@version` ref (scoped names keep their leading `@`). */
  private static parseRef(input: string): PackageRef {
    const at = input.lastIndexOf("@");
    if (at > 0) return { name: input.slice(0, at), version: input.slice(at + 1) };
    return { name: input };
  }

  /** The unscoped tail of a package name, for default output filenames. */
  private static unscoped(name: string): string {
    const slash = name.indexOf("/");
    return slash < 0 ? name : name.slice(slash + 1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL && npx tsx --test src/package-manager/tests/package-manager.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL
git add src/package-manager/package-manager.ts src/package-manager/tests/package-manager.test.ts
git commit -m "feat: PackageManager registry-facing package surface

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rewire the CLI, delete `commands.ts`, update exports

**Files:**
- Modify: `src/package-manager/cli.ts`
- Modify: `src/package-manager/index.ts`
- Delete: `src/package-manager/commands.ts`
- Rename+retarget: `src/package-manager/tests/commands.test.ts` → `src/package-manager/tests/compiler-integration.test.ts`

**Interfaces:**
- Consumes: `PackageCompiler` (`compile(dir, {scope?, outDir?}): Promise<CompileResult>`) from `./package-compiler.js`; `PackageManager` from `./package-manager.js`; `ProjectInstaller` from `./project-installer.js`; `resolveRegistryConfig(dir, options, env)` + `type RegistryCliOptions` from `./registry/config.js`.
- Produces: no new exported types; `commands.ts` and its exports (`packCommand`, `publishCommand`, `installCommand`, `listCommand`, `versionsCommand`, `getCommand`, `PackOptions`) cease to exist.

- [ ] **Step 1: Retarget the integration test onto `PackageCompiler` and rename it**

Rename the file and update its body to use `PackageCompiler` directly (it already sets up a real on-disk `node_modules`, so it becomes the compiler's disk-integration test):

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL
git mv src/package-manager/tests/commands.test.ts src/package-manager/tests/compiler-integration.test.ts
```

Then edit `src/package-manager/tests/compiler-integration.test.ts`:
- Change the import line `import { PackageCompiler, packCommand } from "../index.js";` to `import { PackageCompiler } from "../index.js";`
- Replace the two `packCommand(...)` call sites:
  - `const result = await packCommand(dir);` → `const result = await new PackageCompiler().compile(dir);`
  - `const result = await packCommand(dir, { scope: "@acme" });` → `const result = await new PackageCompiler().compile(dir, { scope: "@acme" });`
- Update the two `test("packCommand …")` titles to `test("compile …")` to match the new focus:
  - `"packCommand compiles against installed deps and writes dist/"` → `"compile builds against installed deps and writes dist/"`
  - `"packCommand honors a scope override end-to-end (name + resolution)"` → `"compile honors a scope override end-to-end (name + resolution)"`

- [ ] **Step 2: Run the renamed test to verify it still passes**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL && npx tsx --test src/package-manager/tests/compiler-integration.test.ts`
Expected: PASS (2 tests) — behavior is unchanged, only the entry point moved from `packCommand` to `PackageCompiler.compile`.

- [ ] **Step 3: Rewrite `cli.ts` to orchestrate the three classes**

Replace `src/package-manager/cli.ts` with (keeping the existing `parseArgs`/`main` module structure per Global Constraints):

```ts
#!/usr/bin/env node
/**
 * The `todl` package-manager CLI (design: package-manager). It orchestrates the
 * three classes directly: `PackageCompiler` (project → compiled package),
 * `ProjectInstaller` (npm install), and `PackageManager` (registry ops).
 * `publish` is the compile-then-publish composition.
 *
 *   todl pack     [dir] [--scope <s>]
 *   todl install  [dir]
 *   todl publish  [dir] [--scope <s>] [--registry <url>] [--token <t>]
 *   todl list     [--registry <url>] [--scope <s>] [--org <o>] [--github-api <url>] [--token <t>]
 *   todl versions <name> [--registry <url>] [--scope <s>] [--token <t>]
 *   todl get      <name>[@version] [--out <file.tgz>] [--registry <url>] [--scope <s>] [--token <t>]
 *
 * Registry config layers flags → env → .npmrc → defaults (see resolveRegistryConfig).
 */
import { join } from "node:path";
import { PackageCompiler } from "./package-compiler.js";
import { PackageManager } from "./package-manager.js";
import { ProjectInstaller } from "./project-installer.js";
import { resolveRegistryConfig, type RegistryCliOptions } from "./registry/config.js";

interface ParsedArgs {
  positionals: string[];
  flags: RegistryCliOptions;
  out?: string;
}

/** Split argv into positionals and known `--flag value` options. */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: RegistryCliOptions = {};
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const value = argv[++i];
    if (value === undefined) break; // trailing flag with no value
    switch (arg.slice(2)) {
      case "registry": flags.registry = value; break;
      case "scope": flags.scope = value; break;
      case "token": flags.token = value; break;
      case "org": flags.org = value; break;
      case "github-api": flags.githubApi = value; break;
      case "out": out = value; break;
      default: break; // unknown flags are ignored
    }
  }
  return out !== undefined ? { positionals, flags, out } : { positionals, flags };
}

const USAGE =
  "usage: todl <pack|install|publish|list|versions|get> [args] [--registry --scope --token --org --github-api --out]";

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { positionals, flags, out } = parseArgs(rest);
  const cwd = ".";
  const manager = () => new PackageManager(resolveRegistryConfig(cwd, flags, process.env));

  switch (command) {
    case "pack": {
      const directory = positionals[0] ?? cwd;
      const result = await new PackageCompiler().compile(directory, flags.scope !== undefined ? { scope: flags.scope } : {});
      if (!result.ok) {
        console.error(result.errors.map((e) => e.message).join("\n"));
        return 1;
      }
      console.error(`packed ${result.files?.length ?? 0} file(s) to ${directory}/dist`);
      return 0;
    }
    case "install":
      return new ProjectInstaller().install(positionals[0] ?? cwd);
    case "publish": {
      const directory = positionals[0] ?? cwd;
      const config = resolveRegistryConfig(directory, flags, process.env);
      const outDir = out ?? join(directory, "dist");
      const result = await new PackageCompiler().compile(directory, { scope: config.scope, outDir });
      if (!result.ok) {
        console.error(result.errors.map((e) => e.message).join("\n"));
        return 1;
      }
      await new PackageManager(config).publish(outDir);
      console.error(`published ${directory}`);
      return 0;
    }
    case "list": {
      const names = await manager().list();
      for (const name of names) console.log(name);
      return 0;
    }
    case "versions": {
      const name = positionals[0];
      if (name === undefined) {
        console.error("usage: todl versions <name>");
        return 1;
      }
      const { versions, distTags } = await manager().versions(name);
      for (const version of versions) console.log(version);
      for (const [tag, version] of Object.entries(distTags)) console.error(`  ${tag} -> ${version}`);
      return 0;
    }
    case "get": {
      const ref = positionals[0];
      if (ref === undefined) {
        console.error("usage: todl get <name>[@version] [--out <file.tgz>]");
        return 1;
      }
      const file = await manager().get(ref, out);
      console.error(`wrote ${file}`);
      return 0;
    }
    default:
      console.error(USAGE);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
```

Note: `publish` previously defaulted its output to `<dir>/dist` and ignored `--out`; here `--out` is honored for the compiled dir too, and the compiled `config.scope` drives the package name (unchanged behavior for the no-`--out` case).

- [ ] **Step 4: Delete `commands.ts` and update `index.ts`**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL
git rm src/package-manager/commands.ts
```

Edit `src/package-manager/index.ts`: remove the `commands.js` export block

```ts
export {
  packCommand,
  publishCommand,
  installCommand,
  listCommand,
  versionsCommand,
  getCommand,
  type PackOptions,
} from "./commands.js";
```

and add, next to the compiler export:

```ts
export { PackageManager, type PackageSource } from "./package-manager.js";
export { ProjectInstaller, type NpmRunner } from "./project-installer.js";
```

- [ ] **Step 5: Verify the whole package-manager suite + the CLI is wired**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL && npx tsx --test src/package-manager/tests/*.test.ts src/package-manager/registry/tests/*.test.ts`
Expected: PASS — all package-manager suites green, no reference to `commands.js`.

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL && npx tsx src/package-manager/cli.ts`
Expected: prints the USAGE line and exits non-zero (no command given) — confirms the CLI still loads with the new imports.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL
git add -A src/package-manager/
git commit -m "refactor: CLI orchestrates PackageCompiler/PackageManager/ProjectInstaller; delete commands.ts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Shrink `RegistryBridge` to a `createManager` adapter

**Files:**
- Modify: `app/src/main/registry/registry-bridge.ts`
- Test: `app/src/main/registry/tests/registry-bridge.test.ts`

**Interfaces:**
- Consumes (type-only): `NpmRegistryConfig`, `PackageRef`, `VersionList`, `InstalledPackage`, `ResolvedClosure`, `PackageSource` from `@pragmatic-tech-ai/todl/package-manager`.
- Produces:
  ```ts
  export interface PackageManagerLike {
    list(): Promise<string[]>;
    versions(name: string): Promise<VersionList>;
    manifestKind(name: string): Promise<string>;
    getContent(ref: PackageRef): Promise<Uint8Array>;
    getPackage(ref: PackageRef): Promise<InstalledPackage>;
    getSources(ref: PackageRef): Promise<PackageSource[]>;
    resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure>;
    publish(compiledDir: string): Promise<void>;
  }
  export interface RegistryBridgeDeps {
    tokenStore: TokenStore;
    settingsStore: SettingsStore;
    createManager(config: NpmRegistryConfig): PackageManagerLike;
    env: Record<string, string | undefined>;
  }
  ```
  The bridge's PUBLIC method names are unchanged (`list`, `versions`, `getContent`, `getPackage`, `getMeta`, `resolveClosure`, `publishDir`, `getSources`, `getConfig`, `setStoredToken`, `useEnvToken`, `listEnvVars`, `setSettings`) so `register-ipc.ts` and the preload need no change.

- [ ] **Step 1: Rewrite the bridge test to inject a fake `PackageManagerLike`**

Replace `app/src/main/registry/tests/registry-bridge.test.ts` with:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RegistryBridge, type PackageManagerLike } from "../registry-bridge.js";
import { TokenStore, type Encryptor } from "../token-store.js";
import { SettingsStore } from "../settings-store.js";

class PlainEncryptor implements Encryptor {
  available() { return true; }
  encrypt(p: string) { return Buffer.from(p, "utf8"); }
  decrypt(c: Buffer) { return c.toString("utf8"); }
}
const freshDir = () => mkdtempSync(join(tmpdir(), "todl-bridge-"));

/** A structural stand-in for PackageManager with per-method overrides. */
class FakeManager implements PackageManagerLike {
  constructor(private readonly over: Partial<PackageManagerLike> = {}) {}
  list() { return this.over.list?.() ?? Promise.resolve([] as string[]); }
  versions(n: string) { return this.over.versions?.(n) ?? Promise.resolve({ versions: ["0.1.0"], distTags: { latest: "0.1.0" } }); }
  manifestKind(n: string) { return this.over.manifestKind?.(n) ?? Promise.resolve(""); }
  getContent(ref: any) { return this.over.getContent?.(ref) ?? Promise.resolve(new Uint8Array()); }
  getPackage(ref: any) { return this.over.getPackage?.(ref) ?? Promise.reject(new Error("no")); }
  getSources(ref: any) { return this.over.getSources?.(ref) ?? Promise.resolve([]); }
  resolveClosure(deps: readonly string[]) { return this.over.resolveClosure?.(deps) ?? Promise.resolve({ metaModels: [], libraries: [], order: [] }); }
  publish(dir: string) { return this.over.publish?.(dir) ?? Promise.resolve(); }
}

function makeBridge(
  over: Partial<PackageManagerLike> = {},
  env: Record<string, string | undefined> = {},
  onConfig?: (config: any) => void,
) {
  const dir = freshDir();
  return new RegistryBridge({
    tokenStore: new TokenStore(dir, new PlainEncryptor()),
    settingsStore: new SettingsStore(dir),
    createManager: (config) => { onConfig?.(config); return new FakeManager(over); },
    env,
  });
}

test("list delegates to the manager", async () => {
  const bridge = makeBridge({ list: () => Promise.resolve(["aws", "microsoft"]) });
  assert.deepEqual((await bridge.list()).sort(), ["aws", "microsoft"]);
});

test("getMeta returns the package kind via manifestKind", async () => {
  const bridge = makeBridge({ manifestKind: () => Promise.resolve("library") });
  assert.equal(await bridge.getMeta("aws"), "library");
});

test("getPackage / getSources / resolveClosure / publishDir delegate to the manager", async () => {
  const bridge = makeBridge({
    getPackage: () => Promise.resolve({ name: "@pragmatic-tech-ai/aws", meta: { kind: "library", id: "aws" }, dependencies: [], document: { nodes: [] } as any }),
    getSources: () => Promise.resolve([{ name: "aws.todl", text: "concept EC2;\n" }]),
    resolveClosure: (deps) => Promise.resolve({ metaModels: [], libraries: [], order: [...deps] }),
    publish: () => Promise.resolve(),
  });
  assert.equal((await bridge.getPackage({ name: "@pragmatic-tech-ai/aws" })).name, "@pragmatic-tech-ai/aws");
  assert.deepEqual(await bridge.getSources({ name: "@pragmatic-tech-ai/aws" }), [{ name: "aws.todl", text: "concept EC2;\n" }]);
  assert.deepEqual((await bridge.resolveClosure(["@pragmatic-tech-ai/aws"])).order, ["@pragmatic-tech-ai/aws"]);
  await bridge.publishDir("/dist"); // resolves without throwing
});

test("getConfig reports settings + hasToken, never the token itself", async () => {
  const bridge = makeBridge();
  let cfg = await bridge.getConfig();
  assert.equal(cfg.hasToken, false);
  assert.equal(cfg.scope, "@pragmatic-tech-ai");
  assert.ok(!("token" in cfg));
  await bridge.setStoredToken("ghp_x");
  cfg = await bridge.getConfig();
  assert.equal(cfg.hasToken, true);
});

test("env-var token: hasToken reflects process.env and never the value", async () => {
  const bridge = makeBridge({}, { GH_PAT: "ghp_fromenv" });
  await bridge.useEnvToken("GH_PAT");
  const cfg = await bridge.getConfig();
  assert.equal(cfg.tokenSource, "env");
  assert.equal(cfg.tokenEnvVar, "GH_PAT");
  assert.equal(cfg.hasToken, true);
  assert.ok(!("token" in cfg));
  await bridge.useEnvToken("NOPE");
  assert.equal((await bridge.getConfig()).hasToken, false);
});

test("listEnvVars returns sorted defined env keys", async () => {
  const bridge = makeBridge({}, { B: "1", A: "2", C: undefined });
  assert.deepEqual(await bridge.listEnvVars(), ["A", "B"]);
});

test("setSettings is reflected in the config handed to createManager", async () => {
  let seenConfig: any;
  const bridge = makeBridge({}, {}, (config) => { seenConfig = config; });
  await bridge.setSettings({ org: "acme" });
  await bridge.list();
  assert.equal(seenConfig.org, "acme");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL/app && npx tsx --test src/main/registry/tests/registry-bridge.test.ts`
Expected: FAIL — `RegistryBridge` still declares the old deps (`createRegistry`/`readPackage`/…) and has no `PackageManagerLike` export.

- [ ] **Step 3: Rewrite the bridge**

Replace `app/src/main/registry/registry-bridge.ts` with:

```ts
/**
 * `RegistryBridge` — the logic behind the `registry:*` / `config:*` IPC channels
 * (design §5 + package-manager). It resolves the app's registry config from its
 * settings + effective token, then delegates every package operation to a
 * `PackageManager` built via the injected `createManager` factory. App-side
 * concerns (config, token source, env-var tokens) stay here. Package-manager
 * symbols are type-only imports, so the test runner needs no bundler alias;
 * only `main/index.ts` runtime-imports package-manager to supply createManager.
 */
import type { TokenStore } from "./token-store.js";
import type { SettingsStore, RegistrySettings } from "./settings-store.js";
import { TokenSource } from "./settings-store.js";
import type {
  NpmRegistryConfig,
  PackageRef,
  VersionList,
  InstalledPackage,
  ResolvedClosure,
  PackageSource,
} from "@pragmatic-tech-ai/todl/package-manager";

/** The subset of `PackageManager` the bridge uses (structurally satisfied by it). */
export interface PackageManagerLike {
  list(): Promise<string[]>;
  versions(name: string): Promise<VersionList>;
  manifestKind(name: string): Promise<string>;
  getContent(ref: PackageRef): Promise<Uint8Array>;
  getPackage(ref: PackageRef): Promise<InstalledPackage>;
  getSources(ref: PackageRef): Promise<PackageSource[]>;
  resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure>;
  publish(compiledDir: string): Promise<void>;
}

/** What `config:get` returns — never the token value (the env-var *name* is not
 *  a secret and is returned so the Setup page can show the current source). */
export interface ConfigView {
  registry: string;
  scope: string;
  org: string;
  tokenSource: TokenSource;
  tokenEnvVar: string;
  hasToken: boolean;
}

export interface RegistryBridgeDeps {
  tokenStore: TokenStore;
  settingsStore: SettingsStore;
  /** Build a manager from a resolved config (prod: (c) => new PackageManager(c)). */
  createManager(config: NpmRegistryConfig): PackageManagerLike;
  /** The process environment, for env-var tokens (prod: `process.env`). */
  env: Record<string, string | undefined>;
}

export class RegistryBridge {
  constructor(private readonly deps: RegistryBridgeDeps) {}

  list(): Promise<string[]> {
    return this.manager().list();
  }

  versions(name: string): Promise<VersionList> {
    return this.manager().versions(name);
  }

  getContent(ref: PackageRef): Promise<Uint8Array> {
    return this.manager().getContent(ref);
  }

  getPackage(ref: PackageRef): Promise<InstalledPackage> {
    return this.manager().getPackage(ref);
  }

  resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure> {
    return this.manager().resolveClosure(rootDeps);
  }

  getMeta(name: string): Promise<string> {
    return this.manager().manifestKind(name);
  }

  publishDir(dir: string): Promise<void> {
    return this.manager().publish(dir);
  }

  getSources(ref: PackageRef): Promise<PackageSource[]> {
    return this.manager().getSources(ref);
  }

  async getConfig(): Promise<ConfigView> {
    const s = this.deps.settingsStore.get();
    return {
      registry: s.registry,
      scope: s.scope,
      org: s.org,
      tokenSource: s.tokenSource,
      tokenEnvVar: s.tokenEnvVar,
      hasToken: this.effectiveToken(s).length > 0,
    };
  }

  async setStoredToken(token: string): Promise<void> {
    this.deps.tokenStore.setToken(token);
    this.deps.settingsStore.update({ tokenSource: TokenSource.Stored });
  }

  async useEnvToken(varName: string): Promise<void> {
    this.deps.settingsStore.update({ tokenSource: TokenSource.Env, tokenEnvVar: varName });
  }

  async listEnvVars(): Promise<string[]> {
    return Object.keys(this.deps.env)
      .filter((k) => this.deps.env[k] !== undefined)
      .sort((a, b) => a.localeCompare(b));
  }

  async setSettings(partial: Partial<{ registry: string; scope: string; org: string; githubApi: string }>): Promise<void> {
    this.deps.settingsStore.update(partial);
  }

  /** The effective token for the current source: the env var's value, or the
   *  stored (encrypted) token. */
  private effectiveToken(settings: RegistrySettings = this.deps.settingsStore.get()): string {
    if (settings.tokenSource === TokenSource.Env) {
      return this.deps.env[settings.tokenEnvVar] ?? "";
    }
    return this.deps.tokenStore.getToken();
  }

  /** Build a manager from the current settings + effective token. */
  private manager(): PackageManagerLike {
    const s = this.deps.settingsStore.get();
    return this.deps.createManager({
      registry: s.registry,
      scope: s.scope,
      org: s.org,
      githubApi: s.githubApi,
      token: this.effectiveToken(s),
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL/app && npx tsx --test src/main/registry/tests/registry-bridge.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL
git add app/src/main/registry/registry-bridge.ts app/src/main/registry/tests/registry-bridge.test.ts
git commit -m "refactor: RegistryBridge delegates to injected PackageManager

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire `createManager` in the app main process

**Files:**
- Modify: `app/src/main/index.ts:4`, `app/src/main/index.ts:39-47`

**Interfaces:**
- Consumes: `PackageManager` from `@pragmatic-tech-ai/todl/package-manager`; the new `RegistryBridgeDeps` shape (`createManager` + `env`, no `createRegistry`/`readPackage`/`resolveClosure`/`readFiles`).

- [ ] **Step 1: Update the runtime import**

In `app/src/main/index.ts`, change line 4 from:

```ts
import { NpmRegistry, TarReader, resolveClosure } from "@pragmatic-tech-ai/todl/package-manager";
```

to:

```ts
import { PackageManager } from "@pragmatic-tech-ai/todl/package-manager";
```

- [ ] **Step 2: Update the bridge construction**

Replace the `new RegistryBridge({...})` block (lines 39-47) with:

```ts
  const bridge = new RegistryBridge({
    tokenStore: new TokenStore(userData, new SafeStorageEncryptor()),
    settingsStore: new SettingsStore(userData),
    createManager: (config) => new PackageManager(config),
    env: process.env,
  });
```

- [ ] **Step 3: Typecheck the app main process**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL/app && npx tsc -p tsconfig.node.json --noEmit`
Expected: no errors from `index.ts` or `registry-bridge.ts` (the old deps are gone; `createManager` matches). If the app has a different node tsconfig name, use the one that covers `src/main` (check `app/electron.vite.config.*` / `app/tsconfig.node.json`).

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL
git add app/src/main/index.ts
git commit -m "feat: wire PackageManager into the app main process

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Full regression + finish the branch

**Files:** none (verification + finish).

- [ ] **Step 1: Run the full core suite**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL && npx tsx --test src/**/tests/*.test.ts`
Expected: all green (the previous baseline was 644 core; this adds package-manager + project-installer tests and removes none of substance). If the shell doesn't expand `src/**`, run the project's configured test script (`npm test`) instead.

- [ ] **Step 2: Run the app unit + e2e suites**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL/app && npx tsx --test src/**/tests/*.test.ts`
Then the app's Playwright e2e per its package.json script (e.g. `npm run test:e2e`).
Expected: app unit green; e2e unchanged (behavior identical — only the bridge internals moved).

- [ ] **Step 3: Confirm no dangling references**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL && git grep -n "commands\.js\|packCommand\|createRegistry\|readPackage:\|readFiles:" -- src app || echo "clean"`
Expected: no matches in `src/`/`app/` source (only historical mentions in `docs/`). If any source match remains, fix it before finishing.

- [ ] **Step 4: Finish the development branch**

Use the **superpowers:finishing-a-development-branch** skill: verify the full suite is green on the merge result, present the merge/PR/keep options, and (per the standing "do not push unless asked" constraint) do not push unless the user chooses the PR option.

---

## Self-Review

**Spec coverage:**
- Boundary (registry-facing manager; compiler/installer own directories) → Tasks 1, 2, 3. ✓
- `PackageManager` API (all 9 methods + `PackageSource`) → Task 2. ✓
- Construction (config in constructor) → Task 2. ✓
- `ProjectInstaller` → Task 1. ✓
- `cli.ts` orchestration incl. compile-then-publish + `commands.ts` deletion → Task 3. ✓
- `RegistryBridge` shrink to `createManager`, kept-vs-removed methods, type-only imports, `PackageSource` moves to core → Tasks 2 (export), 4. ✓
- `main/index.ts` wiring → Task 5. ✓
- Error semantics (getPackage throws, manifestKind "", publish/getContent propagate, resolveClosure ignores non-TODL, cli publish fails loudly) → covered by Task 2 tests + Task 3 cli body. ✓
- Testing (package-manager, project-installer, retargeted compiler-integration, bridge rewrite) → Tasks 1–4. ✓
- Non-goals (no compiler/registry/protocol/IPC/preload change) → honored; register-ipc + preload untouched (Task 4 note). ✓

**Placeholder scan:** No TBD/TODO; every code step has full content. ✓

**Type consistency:** `manifestKind`/`publish`/`get(refInput, outFile?)` names match across manager, bridge `PackageManagerLike`, and cli. `PackageSource {name,text}` identical in core and bridge import. `ResolvedClosure {metaModels,libraries,order}` matches `resolve.ts`. Bridge public method names (`getMeta`, `publishDir`) unchanged so `register-ipc.ts` still compiles. ✓
