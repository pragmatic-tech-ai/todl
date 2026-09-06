# TODL App Electron — SP2: Registry IPC Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Electron TODL app a secure main-process bridge to a live npm-compatible registry (GitHub Packages) — so the renderer can list/inspect/fetch packages and resolve their dependency closures — with the auth token stored encrypted in the main process and never exposed to the renderer. No visible UI yet (that is SP3); SP2 ends at a renderer call that round-trips through the bridge.

**Architecture:** The `NpmRegistry` wire client already exists in the TODL core (`src/package-manager/registry/`). SP2 adds: a **tar reader** (`TarReader`, core, symmetric to the existing `createTgz` writer) that turns fetched tarball bytes into an `InstalledPackage`; a main-process **`TokenStore`** (safeStorage-encrypted) and **`SettingsStore`** (JSON in `userData`); a pure, injectable **`RegistryBridge`** whose methods back the IPC channels; the `ipcMain.handle` wiring + a populated preload `window.todl` surface; and a typed renderer **`RegistryClient`** over that surface. Everything network-facing lives in main (no CORS, Node crypto/zlib available); the renderer reaches Node only through the audited `window.todl` bridge.

**Tech Stack:** Electron 43 (`ipcMain`/`ipcRenderer`/`contextBridge`/`safeStorage`), electron-vite 5 (main-section vite `resolve.alias`), the existing `@pragmatic-tech-ai/todl` package-manager module, `tsx --test` + `node:test`/`node:assert` (repo test convention), `@playwright/test` `_electron` (bridge round-trip smoke).

**Spec:** `docs/superpowers/specs/2026-09-04-todl-app-electron-package-manager-design.md` (SP2 §5, plus the tar reader from §5 and security §7). This plan implements SP2 only. It follows the as-built (post-flatten) app layout: the renderer lives directly under `app/src/renderer/` (e.g. `app/src/renderer/pages/…`), **not** `app/src/renderer/src/…` as the older SP1 plan text said.

## Global Constraints

- **The token never crosses to the renderer.** `config:get` returns `hasToken: boolean`, never the value. The token is written only to `userData`, encrypted via `safeStorage`. No plaintext token on disk, ever.
- **Secure Electron topology unchanged:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (already set). The renderer reaches Node only through the `window.todl` `contextBridge` surface — no `ipcRenderer` leakage into the renderer.
- **Main and preload stay CJS.** Do NOT add `"type": "module"` to `app/package.json`. Main uses `__dirname` (CJS).
- **Testability seams (design §8):** `RegistryBridge` handler logic must be unit-testable with **no running Electron** — inject the registry factory, the tar reader, the closure resolver, and the two stores. `TokenStore` must be testable with **no Electron `safeStorage`** — inject an `Encryptor`. Stores take their `userData` dir as a constructor argument (inject a temp dir in tests).
- **OOP, no free functions (workspace rule, `~/.claude/CLAUDE.md`):** every new unit of behavior is a class method (static where there is no state). This is why the new tar reader is a `TarReader` **class** even though its sibling writer `createTgz` is a free function — the writer is pre-existing and out of scope; new code follows the OOP rule. Module-level `const` for true constants is allowed.
- **Cross-package imports of package-manager VALUES happen only in `app/src/main/index.ts`** (bundled by vite via the main-section alias). Every other new module imports package-manager symbols as **`import type`** only (erased at runtime, so `tsx --test` needs no alias; `tsc` resolves via tsconfig `paths`).
- **Scope/default (verbatim):** registry `https://npm.pkg.github.com`, scope `@pragmatic-tech-ai`, org `pragmatic-tech-ai`, githubApi `https://api.github.com`.
- **Tests** live in a `tests/` subfolder next to source (repo convention). **Commits** on a new branch `feat/app-package-manager` cut from `main`; stage only each task's files; **never `git push`**.

---

### Task 0: Branch

**Files:** none (git only)

- [ ] **Step 1:** Confirm clean tree on `main`: `git -C TODL status -sb` (expect `## main...origin/main`, no unstaged changes that belong elsewhere).
- [ ] **Step 2:** `git -C TODL checkout -b feat/app-package-manager`
- [ ] **Step 3: Verify** — `git -C TODL branch --show-current` prints `feat/app-package-manager`.

---

### Task 1: `TarReader` — read tarball bytes into files + an `InstalledPackage` (TODL core)

The inverse of `createTgz` (`src/package-manager/registry/tar.ts`): gunzip, walk 512-byte USTAR blocks, and reconstruct `{ path, bytes }` entries. `readPackage` then interprets a package tarball (`package/package.json` + `package/model.json`) as an `InstalledPackage`, mirroring the Node loader's `readPackage(dir)` semantics (returns `undefined` when the tarball is not a TODL package).

**Files:**
- Create: `src/package-manager/registry/tar-reader.ts`
- Create: `src/package-manager/registry/tests/tar-reader.test.ts`
- Modify: `src/package-manager/registry/index.ts` (export `TarReader`, `TarFile`)
- Modify: `src/package-manager/index.ts` (re-export `TarReader`, `TarFile`)
- Modify: `package.json` (add `./package-manager` to `exports`)

**Interfaces:**
- Consumes: `createTgz`, `type TarEntry` from `./tar.js`; `type InstalledPackage` from `../resolve.js`; `type TodlPackageMeta` from `../package-json.js`; `type TodlDocument` from `../../emit/json.js`.
- Produces: `class TarReader` with `static read(bytes: Uint8Array): TarFile[]` and `static readPackage(bytes: Uint8Array): InstalledPackage | undefined`; `interface TarFile { path: string; bytes: Uint8Array }`. Later tasks (`RegistryBridge` production wiring in `main/index.ts`) call `TarReader.readPackage`.

- [ ] **Step 1: Write the failing test** — `src/package-manager/registry/tests/tar-reader.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTgz } from "../tar.js";
import { TarReader } from "../tar-reader.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

test("read round-trips the entries createTgz wrote (paths + exact bytes)", () => {
  const entries = [
    { path: "package/package.json", bytes: enc.encode('{"name":"x"}') },
    { path: "package/model.json", bytes: enc.encode('{"nodes":[]}') },
    { path: "package/src/microsoft.todl", bytes: enc.encode("concept X;\n") },
  ];
  const files = TarReader.read(createTgz(entries));
  const byPath = new Map(files.map((f) => [f.path, f.bytes]));
  assert.deepEqual([...byPath.keys()].sort(), entries.map((e) => e.path).sort());
  for (const e of entries) assert.ok(same(byPath.get(e.path)!, e.bytes), `bytes differ for ${e.path}`);
});

test("read handles a body whose length is an exact multiple of 512 (no stray padding)", () => {
  const body = enc.encode("a".repeat(512));
  const files = TarReader.read(createTgz([{ path: "package/big", bytes: body }]));
  assert.equal(files.length, 1);
  assert.ok(same(files[0]!.bytes, body));
});

test("read reconstructs a path long enough to use the USTAR prefix split", () => {
  const longPath = `package/${"d/".repeat(60)}leaf.todl`; // > 100 bytes → prefix+name split
  const files = TarReader.read(createTgz([{ path: longPath, bytes: enc.encode("z") }]));
  assert.equal(files[0]!.path, longPath);
});

test("readPackage builds an InstalledPackage from a TODL package tarball", () => {
  const pkgJson = { name: "@pragmatic-tech-ai/aws", dependencies: { "@pragmatic-tech-ai/tech-architecture": "0.1.0" }, todl: { kind: "library", id: "aws" } };
  const model = { nodes: [{ id: "n1" }], edges: [] };
  const tgz = createTgz([
    { path: "package/package.json", bytes: enc.encode(JSON.stringify(pkgJson)) },
    { path: "package/model.json", bytes: enc.encode(JSON.stringify(model)) },
  ]);
  const pkg = TarReader.readPackage(tgz);
  assert.ok(pkg !== undefined);
  assert.equal(pkg!.name, "@pragmatic-tech-ai/aws");
  assert.deepEqual(pkg!.meta, { kind: "library", id: "aws" });
  assert.deepEqual(pkg!.dependencies, ["@pragmatic-tech-ai/tech-architecture"]);
  assert.equal(dec.decode(enc.encode(JSON.stringify(pkg!.document))), JSON.stringify(model));
});

test("readPackage returns undefined when the tarball is not a TODL package", () => {
  const noTodl = createTgz([{ path: "package/package.json", bytes: enc.encode('{"name":"plain"}') }]);
  assert.equal(TarReader.readPackage(noTodl), undefined);
  const noModel = createTgz([{ path: "package/package.json", bytes: enc.encode('{"name":"x","todl":{"kind":"library","id":"x"}}') }]);
  assert.equal(TarReader.readPackage(noModel), undefined);
});
```

- [ ] **Step 2: Run RED** — `cd TODL && npx tsx --test src/package-manager/registry/tests/tar-reader.test.ts`
  Expected: FAIL (`Cannot find module './tar-reader.js'`).

- [ ] **Step 3: Implement `src/package-manager/registry/tar-reader.ts`:**

```ts
/**
 * `TarReader` — the read side of the registry's tar support, the inverse of
 * `createTgz` (design: todl-app-electron-package-manager §5). Gunzips a fetched
 * npm tarball and walks its 512-byte USTAR blocks back into `{ path, bytes }`
 * entries, then interprets a package tarball as an `InstalledPackage`. Kept in
 * the package-manager module (Node-side, `node:zlib`) so tests, the CLI, and the
 * app's main process all share one implementation. A class (workspace OOP rule);
 * the sibling writer `createTgz` predates the rule and is left as-is.
 */
import { gunzipSync } from "node:zlib";
import type { TodlDocument } from "../../emit/json.js";
import type { TodlPackageMeta } from "../package-json.js";
import type { InstalledPackage } from "../resolve.js";

/** One file recovered from a tar archive. `path` is the full archive path,
 *  e.g. `package/model.json`. */
export interface TarFile {
  path: string;
  bytes: Uint8Array;
}

/** The subset of a package.json `TarReader.readPackage` reads. */
interface RawPackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  todl?: TodlPackageMeta;
}

const BLOCK = 512;
const decoder = new TextDecoder();

export class TarReader {
  /** Gunzip `bytes` and return every regular-file entry, in archive order. */
  static read(bytes: Uint8Array): TarFile[] {
    const tar = gunzipSync(bytes);
    const files: TarFile[] = [];
    let offset = 0;
    while (offset + BLOCK <= tar.length) {
      const header = tar.subarray(offset, offset + BLOCK);
      if (TarReader.isZeroBlock(header)) break; // two zero blocks terminate the archive
      const name = TarReader.field(header, 0, 100);
      const prefix = TarReader.field(header, 345, 155);
      const size = TarReader.octal(header, 124, 12);
      const path = prefix.length > 0 ? `${prefix}/${name}` : name;
      const start = offset + BLOCK;
      files.push({ path, bytes: tar.subarray(start, start + size) });
      offset = start + TarReader.roundUp(size);
    }
    return files;
  }

  /** Interpret a package tarball as an `InstalledPackage`, or `undefined` if it is
   *  not a TODL package (no `package/package.json` with a `todl` block + `name`, or
   *  no `package/model.json`) — mirroring the Node loader's `readPackage(dir)`. */
  static readPackage(bytes: Uint8Array): InstalledPackage | undefined {
    const byPath = new Map(TarReader.read(bytes).map((f) => [f.path, f.bytes]));
    const packageJson = byPath.get("package/package.json");
    const modelJson = byPath.get("package/model.json");
    if (packageJson === undefined || modelJson === undefined) return undefined;
    const pkg = JSON.parse(decoder.decode(packageJson)) as RawPackageJson;
    if (pkg.todl === undefined || pkg.name === undefined) return undefined;
    return {
      name: pkg.name,
      meta: pkg.todl,
      dependencies: Object.keys(pkg.dependencies ?? {}),
      document: JSON.parse(decoder.decode(modelJson)) as TodlDocument,
    };
  }

  /** Read a fixed-width, null/space-terminated string field from a header block. */
  private static field(header: Uint8Array, offset: number, length: number): string {
    let end = offset;
    const limit = offset + length;
    while (end < limit && header[end] !== 0 && header[end] !== 0x20) end++;
    return decoder.decode(header.subarray(offset, end));
  }

  /** Parse a null/space-terminated octal numeric field (tar's size encoding). */
  private static octal(header: Uint8Array, offset: number, length: number): number {
    const text = TarReader.field(header, offset, length).trim();
    return text.length === 0 ? 0 : parseInt(text, 8);
  }

  /** Round a body size up to the next 512-byte block boundary. */
  private static roundUp(size: number): number {
    const remainder = size % BLOCK;
    return remainder === 0 ? size : size + (BLOCK - remainder);
  }

  private static isZeroBlock(header: Uint8Array): boolean {
    for (let i = 0; i < BLOCK; i++) if (header[i] !== 0) return false;
    return true;
  }
}
```

- [ ] **Step 4: Export from `src/package-manager/registry/index.ts`** — add after the `createTgz` export line:

```ts
export { TarReader, type TarFile } from "./tar-reader.js";
```

- [ ] **Step 5: Re-export from `src/package-manager/index.ts`** — extend the `./registry/index.js` re-export block (which currently lists `createTgz`, `type TarEntry`, …) by adding `TarReader` and `type TarFile` to that same `export { … } from "./registry/index.js";` statement.

- [ ] **Step 6: Add the `./package-manager` subpath to `package.json` `exports`** (so `tsc` and real npm consumers can resolve `@pragmatic-tech-ai/todl/package-manager`; insert after the `./language-server` block):

```json
    "./package-manager": {
      "types": "./dist/package-manager/index.d.ts",
      "import": {
        "development": "./src/package-manager/index.ts",
        "default": "./dist/package-manager/index.js"
      }
    }
```

- [ ] **Step 7: Run GREEN** — `cd TODL && npx tsx --test src/package-manager/registry/tests/tar-reader.test.ts` → all 5 tests PASS. Then the full package-manager suite to confirm no regressions: `npx tsx --test "src/package-manager/**/*.test.ts"` → PASS.

- [ ] **Step 8: Commit**
```bash
git add src/package-manager/registry/tar-reader.ts src/package-manager/registry/tests/tar-reader.test.ts src/package-manager/registry/index.ts src/package-manager/index.ts package.json
git commit -m "feat(package-manager): TarReader — read tarball bytes into an InstalledPackage" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: App test runner + `TokenStore` (safeStorage-encrypted, injectable `Encryptor`)

Adds a `tsx --test` runner to the app (the app so far has only Playwright), then the encrypted token store. `TokenStore` imports **no** Electron — it takes an `Encryptor` so the unit test injects a reversible fake and asserts encrypt-at-rest. The real `safeStorage`-backed encryptor is a separate file wired in Task 6.

**Files:**
- Modify: `app/package.json` (add `tsx` devDep + `test` script)
- Create: `app/src/main/registry/token-store.ts`
- Create: `app/src/main/registry/tests/token-store.test.ts`

**Interfaces:**
- Produces: `interface Encryptor { available(): boolean; encrypt(plain: string): Buffer; decrypt(cipher: Buffer): string }`; `class TokenStore` constructed as `new TokenStore(userDataDir: string, encryptor: Encryptor)` with `getToken(): string`, `setToken(token: string): void`, `clear(): void`, `hasToken(): boolean`. Consumed by `RegistryBridge` (Task 4) and wired with `SafeStorageEncryptor` in `main/index.ts` (Task 6).

- [ ] **Step 1: Add the runner to `app/package.json`** — add `"test": "tsx --test \"src/**/tests/*.test.ts\""` to `scripts`, and `"tsx": "^4.19.2"` to `devDependencies`. Then `npm --prefix app install`.

- [ ] **Step 2: Write the failing test** — `app/src/main/registry/tests/token-store.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenStore, type Encryptor } from "../token-store.js";

/** A reversible, non-identity fake: XOR-with-0x5A then base64. Proves the on-disk
 *  bytes are NOT the plaintext (encrypt-at-rest) while remaining decryptable. */
class FakeEncryptor implements Encryptor {
  available(): boolean {
    return true;
  }
  encrypt(plain: string): Buffer {
    const raw = Buffer.from(plain, "utf8").map((b) => b ^ 0x5a);
    return Buffer.from(raw.toString("base64"), "utf8");
  }
  decrypt(cipher: Buffer): string {
    const raw = Buffer.from(cipher.toString("utf8"), "base64").map((b) => b ^ 0x5a);
    return raw.toString("utf8");
  }
}

const freshDir = () => mkdtempSync(join(tmpdir(), "todl-token-"));

test("setToken persists encrypted; getToken round-trips the value", () => {
  const dir = freshDir();
  const store = new TokenStore(dir, new FakeEncryptor());
  assert.equal(store.hasToken(), false);
  store.setToken("ghp_secret123");
  assert.equal(store.hasToken(), true);
  assert.equal(store.getToken(), "ghp_secret123");

  const onDisk = readFileSync(join(dir, "registry-token.bin"));
  assert.ok(!onDisk.toString("utf8").includes("ghp_secret123"), "token stored in plaintext");
});

test("getToken returns empty string when no token is stored", () => {
  assert.equal(new TokenStore(freshDir(), new FakeEncryptor()).getToken(), "");
});

test("clear removes the stored token", () => {
  const dir = freshDir();
  const store = new TokenStore(dir, new FakeEncryptor());
  store.setToken("t");
  store.clear();
  assert.equal(store.hasToken(), false);
  assert.equal(existsSync(join(dir, "registry-token.bin")), false);
});

test("when encryption is unavailable, the token is kept in memory but not written", () => {
  class Unavailable extends FakeEncryptor {
    available(): boolean {
      return false;
    }
  }
  const dir = freshDir();
  const store = new TokenStore(dir, new Unavailable());
  store.setToken("mem-only");
  assert.equal(store.getToken(), "mem-only");
  assert.equal(existsSync(join(dir, "registry-token.bin")), false);
});
```

- [ ] **Step 3: Run RED** — `npm --prefix app test` → FAIL (`Cannot find module '../token-store.js'`).

- [ ] **Step 4: Implement `app/src/main/registry/token-store.ts`:**

```ts
/**
 * `TokenStore` — the registry auth token, encrypted at rest in `userData`
 * (design §5, security §7). The renderer never sees the token; only `hasToken()`
 * crosses the bridge. Encryption is injected as an `Encryptor` so the unit test
 * runs with no Electron; production wires `SafeStorageEncryptor` (Task 6). If
 * encryption is unavailable (rare Linux without a keyring), the token is held in
 * memory for the session and never written in plaintext.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The encryption seam. `available()` gates writing to disk. */
export interface Encryptor {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}

const TOKEN_FILE = "registry-token.bin";

export class TokenStore {
  private readonly path: string;
  private memoryToken = "";

  constructor(
    private readonly userDataDir: string,
    private readonly encryptor: Encryptor,
  ) {
    this.path = join(userDataDir, TOKEN_FILE);
  }

  hasToken(): boolean {
    return this.getToken().length > 0;
  }

  getToken(): string {
    if (this.memoryToken.length > 0) return this.memoryToken;
    if (!existsSync(this.path)) return "";
    return this.encryptor.decrypt(readFileSync(this.path));
  }

  setToken(token: string): void {
    if (!this.encryptor.available()) {
      this.memoryToken = token; // session-only fallback; never write plaintext
      return;
    }
    mkdirSync(this.userDataDir, { recursive: true });
    writeFileSync(this.path, this.encryptor.encrypt(token));
    this.memoryToken = "";
  }

  clear(): void {
    this.memoryToken = "";
    if (existsSync(this.path)) rmSync(this.path);
  }
}
```

- [ ] **Step 5: Run GREEN** — `npm --prefix app test` → 4 TokenStore tests PASS.

- [ ] **Step 6: Commit**
```bash
git add app/package.json app/package-lock.json app/src/main/registry/token-store.ts app/src/main/registry/tests/token-store.test.ts
git commit -m "feat(app): TokenStore (safeStorage-encrypted) + tsx test runner" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `SettingsStore` (registry URL / scope / org / githubApi in `userData`)

Persists the registry connection settings as JSON in `userData`, with the SP2 defaults. Pure `node:fs`, no Electron.

**Files:**
- Create: `app/src/main/registry/settings-store.ts`
- Create: `app/src/main/registry/tests/settings-store.test.ts`

**Interfaces:**
- Produces: `interface RegistrySettings { registry: string; scope: string; org: string; githubApi: string }`; `class SettingsStore` constructed as `new SettingsStore(userDataDir: string)` with `get(): RegistrySettings` and `update(partial: Partial<RegistrySettings>): void`. Consumed by `RegistryBridge` (Task 4).

- [ ] **Step 1: Write the failing test** — `app/src/main/registry/tests/settings-store.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsStore } from "../settings-store.js";

const freshDir = () => mkdtempSync(join(tmpdir(), "todl-settings-"));

test("get returns the SP2 defaults when nothing is stored", () => {
  assert.deepEqual(new SettingsStore(freshDir()).get(), {
    registry: "https://npm.pkg.github.com",
    scope: "@pragmatic-tech-ai",
    org: "pragmatic-tech-ai",
    githubApi: "https://api.github.com",
  });
});

test("update merges a partial and persists across instances", () => {
  const dir = freshDir();
  new SettingsStore(dir).update({ scope: "@acme", org: "acme" });
  const reloaded = new SettingsStore(dir).get();
  assert.equal(reloaded.scope, "@acme");
  assert.equal(reloaded.org, "acme");
  assert.equal(reloaded.registry, "https://npm.pkg.github.com"); // untouched default kept
});
```

- [ ] **Step 2: Run RED** — `npm --prefix app test` → FAIL (`Cannot find module '../settings-store.js'`).

- [ ] **Step 3: Implement `app/src/main/registry/settings-store.ts`:**

```ts
/**
 * `SettingsStore` — the registry connection settings (URL, scope, org, GitHub API
 * base), persisted as JSON in `userData` (design §5). Defaults target GitHub
 * Packages under the `@pragmatic-tech-ai` scope. Pure `node:fs`; the `userData`
 * dir is injected so the unit test uses a temp dir.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface RegistrySettings {
  registry: string;
  scope: string;
  org: string;
  githubApi: string;
}

const SETTINGS_FILE = "registry-settings.json";
const DEFAULTS: RegistrySettings = {
  registry: "https://npm.pkg.github.com",
  scope: "@pragmatic-tech-ai",
  org: "pragmatic-tech-ai",
  githubApi: "https://api.github.com",
};

export class SettingsStore {
  private readonly path: string;

  constructor(private readonly userDataDir: string) {
    this.path = join(userDataDir, SETTINGS_FILE);
  }

  get(): RegistrySettings {
    if (!existsSync(this.path)) return { ...DEFAULTS };
    const stored = JSON.parse(readFileSync(this.path, "utf8")) as Partial<RegistrySettings>;
    return { ...DEFAULTS, ...stored };
  }

  update(partial: Partial<RegistrySettings>): void {
    const next = { ...this.get(), ...partial };
    mkdirSync(this.userDataDir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(next, null, 2));
  }
}
```

- [ ] **Step 4: Run GREEN** — `npm --prefix app test` → SettingsStore tests PASS (TokenStore tests still pass).

- [ ] **Step 5: Commit**
```bash
git add app/src/main/registry/settings-store.ts app/src/main/registry/tests/settings-store.test.ts
git commit -m "feat(app): SettingsStore — registry connection settings in userData" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `RegistryBridge` — the injectable handler logic behind the IPC channels

The heart of SP2: one class whose methods back each `registry:*` / `config:*` channel. It builds an `NpmRegistry` per call from the current settings + token via an injected factory, so a test drives the whole thing over the in-memory `HttpTransport` fake with no network and no Electron. All package-manager symbols are **`import type`** only.

**Files:**
- Create: `app/src/main/registry/registry-bridge.ts`
- Create: `app/src/main/registry/tests/registry-bridge.test.ts`

**Interfaces:**
- Consumes: `TokenStore` (Task 2), `SettingsStore` + `RegistrySettings` (Task 3); `type NpmRegistryConfig`, `type PackageRef`, `type VersionList`, `type InstalledPackage`, `type ResolvedClosure` from `@pragmatic-tech-ai/todl/package-manager` (type-only).
- Produces: `interface RegistryLike` (the subset of `NpmRegistry` the bridge uses); `interface ConfigView { registry: string; scope: string; org: string; hasToken: boolean }`; `interface RegistryBridgeDeps`; `class RegistryBridge` with methods `list()`, `versions(name)`, `getContent(ref)`, `getPackage(ref)`, `resolveClosure(rootDeps)`, `publishDir(dir)`, `getConfig()`, `setToken(token)`, `setSettings(partial)`. Consumed by `main/index.ts` (Task 6, `ipcMain.handle` wiring) and shaped by the preload surface (Task 5) + renderer client (Task 7).

- [ ] **Step 1: Write the failing test** — `app/src/main/registry/tests/registry-bridge.test.ts`. It backs the injected registry factory with the **real** `NpmRegistry` over the existing `FakeRegistry` transport pattern — but to avoid a package-manager value import here, the factory is a small structural fake that serves fixtures directly:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RegistryBridge, type RegistryLike } from "../registry-bridge.js";
import { TokenStore, type Encryptor } from "../token-store.js";
import { SettingsStore } from "../settings-store.js";

class PlainEncryptor implements Encryptor {
  available() {
    return true;
  }
  encrypt(p: string) {
    return Buffer.from(p, "utf8");
  }
  decrypt(c: Buffer) {
    return c.toString("utf8");
  }
}
const freshDir = () => mkdtempSync(join(tmpdir(), "todl-bridge-"));
const enc = new TextEncoder();

/** A structural stand-in for NpmRegistry: serves a fixed catalog + tarball bytes. */
class FakeRegistry implements RegistryLike {
  constructor(
    private readonly names: string[],
    private readonly content: Map<string, Uint8Array>,
  ) {}
  listPackages() {
    return Promise.resolve(this.names);
  }
  listVersions(name: string) {
    return Promise.resolve({ versions: ["0.1.0"], distTags: { latest: "0.1.0" } });
  }
  getContent(ref: { name: string }) {
    const bytes = this.content.get(ref.name);
    if (bytes === undefined) return Promise.reject(new Error(`no ${ref.name}`));
    return Promise.resolve(bytes);
  }
  publishDir() {
    return Promise.resolve();
  }
}

function makeBridge(registry: RegistryLike, readPackage = () => undefined as any, resolve = () => ({}) as any) {
  const dir = freshDir();
  return new RegistryBridge({
    tokenStore: new TokenStore(dir, new PlainEncryptor()),
    settingsStore: new SettingsStore(dir),
    createRegistry: () => registry,
    readPackage,
    resolveClosure: resolve,
  });
}

test("list delegates to the registry client", async () => {
  const bridge = makeBridge(new FakeRegistry(["aws", "microsoft"], new Map()));
  assert.deepEqual((await bridge.list()).sort(), ["aws", "microsoft"]);
});

test("getConfig reports settings + hasToken, never the token itself", async () => {
  const bridge = makeBridge(new FakeRegistry([], new Map()));
  let cfg = await bridge.getConfig();
  assert.equal(cfg.hasToken, false);
  assert.equal(cfg.scope, "@pragmatic-tech-ai");
  assert.ok(!("token" in cfg));
  await bridge.setToken("ghp_x");
  cfg = await bridge.getConfig();
  assert.equal(cfg.hasToken, true);
});

test("setSettings is reflected by a rebuilt registry config", async () => {
  let seenConfig: any;
  const dir = freshDir();
  const bridge = new RegistryBridge({
    tokenStore: new TokenStore(dir, new PlainEncryptor()),
    settingsStore: new SettingsStore(dir),
    createRegistry: (config) => {
      seenConfig = config;
      return new FakeRegistry([], new Map());
    },
    readPackage: () => undefined as any,
    resolveClosure: () => ({}) as any,
  });
  await bridge.setSettings({ org: "acme" });
  await bridge.list();
  assert.equal(seenConfig.org, "acme");
});

test("resolveClosure BFS-fetches transitive deps then delegates to the pure resolver", async () => {
  // aws depends on tech-architecture; the bridge must fetch BOTH before resolving.
  const content = new Map<string, Uint8Array>([
    ["@pragmatic-tech-ai/aws", enc.encode("aws-bytes")],
    ["@pragmatic-tech-ai/tech-architecture", enc.encode("meta-bytes")],
  ]);
  const installed: Record<string, any> = {
    "aws-bytes": { name: "@pragmatic-tech-ai/aws", meta: { kind: "library", id: "aws" }, dependencies: ["@pragmatic-tech-ai/tech-architecture"], document: { nodes: [] } },
    "meta-bytes": { name: "@pragmatic-tech-ai/tech-architecture", meta: { kind: "meta-model", id: "tech-architecture" }, dependencies: [], document: { nodes: [] } },
  };
  const fetched: string[] = [];
  const bridge = makeBridge(
    new FakeRegistry([], content),
    (bytes: Uint8Array) => installed[new TextDecoder().decode(bytes)],
    (pkgs: any[], roots: string[]) => ({ order: pkgs.map((p) => p.name), roots }),
  );
  const closure: any = await bridge.resolveClosure(["@pragmatic-tech-ai/aws"]);
  assert.deepEqual(closure.order.sort(), ["@pragmatic-tech-ai/aws", "@pragmatic-tech-ai/tech-architecture"]);
});

test("getPackage reads the fetched tarball into an InstalledPackage", async () => {
  const content = new Map<string, Uint8Array>([["@pragmatic-tech-ai/aws", enc.encode("aws-bytes")]]);
  const bridge = makeBridge(new FakeRegistry([], content), () => ({ name: "@pragmatic-tech-ai/aws", meta: { kind: "library", id: "aws" }, dependencies: [], document: { nodes: [] } }) as any);
  const pkg: any = await bridge.getPackage({ name: "@pragmatic-tech-ai/aws" });
  assert.equal(pkg.name, "@pragmatic-tech-ai/aws");
});
```

- [ ] **Step 2: Run RED** — `npm --prefix app test` → FAIL (`Cannot find module '../registry-bridge.js'`).

- [ ] **Step 3: Implement `app/src/main/registry/registry-bridge.ts`:**

```ts
/**
 * `RegistryBridge` — the logic behind the `registry:*` / `config:*` IPC channels
 * (design §5). Pure over injected collaborators (a registry factory, the tar
 * reader, the closure resolver, and the two stores) so it unit-tests with no
 * running Electron. `main/index.ts` constructs it with the real package-manager
 * symbols and wires each method to `ipcMain.handle`. Package-manager symbols are
 * type-only imports here, so the test runner needs no bundler alias.
 */
import type { TokenStore } from "./token-store.js";
import type { SettingsStore } from "./settings-store.js";
import type {
  NpmRegistryConfig,
  PackageRef,
  VersionList,
  InstalledPackage,
  ResolvedClosure,
} from "@pragmatic-tech-ai/todl/package-manager";

/** The subset of `NpmRegistry` the bridge uses (structurally satisfied by it). */
export interface RegistryLike {
  listPackages(): Promise<string[]>;
  listVersions(name: string): Promise<VersionList>;
  getContent(ref: PackageRef): Promise<Uint8Array>;
  publishDir(dir: string): Promise<void>;
}

/** What `config:get` returns — never the token. */
export interface ConfigView {
  registry: string;
  scope: string;
  org: string;
  hasToken: boolean;
}

export interface RegistryBridgeDeps {
  tokenStore: TokenStore;
  settingsStore: SettingsStore;
  /** Build a registry client from a resolved config (prod: `new NpmRegistry(config)`). */
  createRegistry(config: NpmRegistryConfig): RegistryLike;
  /** Interpret tarball bytes as an installed package (prod: `TarReader.readPackage`). */
  readPackage(bytes: Uint8Array): InstalledPackage | undefined;
  /** Resolve a dependency closure (prod: the package-manager `resolveClosure`). */
  resolveClosure(packages: readonly InstalledPackage[], rootDeps: readonly string[]): ResolvedClosure;
}

export class RegistryBridge {
  constructor(private readonly deps: RegistryBridgeDeps) {}

  async list(): Promise<string[]> {
    return this.registry().listPackages();
  }

  async versions(name: string): Promise<VersionList> {
    return this.registry().listVersions(name);
  }

  async getContent(ref: PackageRef): Promise<Uint8Array> {
    return this.registry().getContent(ref);
  }

  async getPackage(ref: PackageRef): Promise<InstalledPackage> {
    const pkg = this.deps.readPackage(await this.registry().getContent(ref));
    if (pkg === undefined) throw new Error(`${ref.name} is not a TODL package`);
    return pkg;
  }

  async resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure> {
    const registry = this.registry();
    const collected: InstalledPackage[] = [];
    const seen = new Set<string>();
    const queue = [...rootDeps];
    while (queue.length > 0) {
      const name = queue.shift() as string;
      if (seen.has(name)) continue;
      seen.add(name);
      const pkg = this.deps.readPackage(await registry.getContent({ name }));
      if (pkg === undefined) continue; // a non-TODL npm dependency; ignore
      collected.push(pkg);
      for (const dep of pkg.dependencies) if (!seen.has(dep)) queue.push(dep);
    }
    return this.deps.resolveClosure(collected, rootDeps);
  }

  async publishDir(dir: string): Promise<void> {
    return this.registry().publishDir(dir);
  }

  async getConfig(): Promise<ConfigView> {
    const s = this.deps.settingsStore.get();
    return { registry: s.registry, scope: s.scope, org: s.org, hasToken: this.deps.tokenStore.hasToken() };
  }

  async setToken(token: string): Promise<void> {
    this.deps.tokenStore.setToken(token);
  }

  async setSettings(partial: Partial<{ registry: string; scope: string; org: string; githubApi: string }>): Promise<void> {
    this.deps.settingsStore.update(partial);
  }

  /** Build a registry client from the current settings + token. */
  private registry(): RegistryLike {
    const s = this.deps.settingsStore.get();
    return this.deps.createRegistry({
      registry: s.registry,
      scope: s.scope,
      org: s.org,
      githubApi: s.githubApi,
      token: this.deps.tokenStore.getToken(),
    });
  }
}
```

- [ ] **Step 4: Run GREEN** — `npm --prefix app test` → all RegistryBridge tests PASS (plus Tasks 2–3).

- [ ] **Step 5: Commit**
```bash
git add app/src/main/registry/registry-bridge.ts app/src/main/registry/tests/registry-bridge.test.ts
git commit -m "feat(app): RegistryBridge — injectable logic behind registry/config IPC" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Preload surface + `window.todl` typing

Populate the `contextBridge` surface with thin `ipcRenderer.invoke` wrappers, and declare the `window.todl` shape for the renderer's TypeScript. Channel names are the single source of truth shared by preload (Task 5) and main wiring (Task 6) — keep them identical.

**Files:**
- Modify: `app/src/preload/index.ts`
- Create: `app/src/renderer/env.d.ts`
- Modify: `app/tsconfig.web.json` (add the `@pragmatic-tech-ai/todl/package-manager` type path)

**Interfaces:**
- Consumes: `type ConfigView` from `../main/registry/registry-bridge.js`; `type PackageRef`, `type VersionList`, `type InstalledPackage`, `type ResolvedClosure` from `@pragmatic-tech-ai/todl/package-manager` (type-only).
- Produces: the global `window.todl` with `registry` + `config` namespaces (the `TodlBridge` interface), consumed by `RegistryClient` (Task 7) and the SP2 e2e (Task 8).

- [ ] **Step 1: Implement `app/src/preload/index.ts`:**

```ts
import { contextBridge, ipcRenderer } from "electron";

/**
 * The single `contextBridge` surface (design §5). Every method is a thin
 * `ipcRenderer.invoke` over a `registry:*` / `config:*` channel — no `ipcRenderer`
 * itself is exposed. The typed shape lives in `renderer/env.d.ts`.
 */
const bridge = {
  registry: {
    list: () => ipcRenderer.invoke("registry:list"),
    versions: (name: string) => ipcRenderer.invoke("registry:versions", name),
    getContent: (ref: unknown) => ipcRenderer.invoke("registry:getContent", ref),
    getPackage: (ref: unknown) => ipcRenderer.invoke("registry:getPackage", ref),
    resolveClosure: (rootDeps: string[]) => ipcRenderer.invoke("registry:resolveClosure", rootDeps),
    publishDir: (dir: string) => ipcRenderer.invoke("registry:publishDir", dir),
  },
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    setToken: (token: string) => ipcRenderer.invoke("config:setToken", token),
    setSettings: (partial: unknown) => ipcRenderer.invoke("config:setSettings", partial),
  },
};

contextBridge.exposeInMainWorld("todl", bridge);
```

- [ ] **Step 2: Create `app/src/renderer/env.d.ts`** (typed global; the renderer client depends on this shape):

```ts
import type {
  PackageRef,
  VersionList,
  InstalledPackage,
  ResolvedClosure,
} from "@pragmatic-tech-ai/todl/package-manager";
import type { ConfigView } from "../main/registry/registry-bridge.js";

export interface TodlBridge {
  registry: {
    list(): Promise<string[]>;
    versions(name: string): Promise<VersionList>;
    getContent(ref: PackageRef): Promise<Uint8Array>;
    getPackage(ref: PackageRef): Promise<InstalledPackage>;
    resolveClosure(rootDeps: string[]): Promise<ResolvedClosure>;
    publishDir(dir: string): Promise<void>;
  };
  config: {
    get(): Promise<ConfigView>;
    setToken(token: string): Promise<void>;
    setSettings(partial: Partial<{ registry: string; scope: string; org: string; githubApi: string }>): Promise<void>;
  };
}

declare global {
  interface Window {
    todl: TodlBridge;
  }
}
```

- [ ] **Step 3: Add the type path to `app/tsconfig.web.json`** — inside `compilerOptions.paths`, add:

```json
      "@pragmatic-tech-ai/todl/package-manager": ["../src/package-manager/index.ts"]
```

- [ ] **Step 4: Verify the build still succeeds** (preload compiles; renderer picks up the ambient global) — `cd TODL && npm run build && npm --prefix app run build`. Then confirm the preload output exposes the surface: `grep -q "registry:list" app/out/preload/index.js && echo PRELOAD_OK`.

- [ ] **Step 5: Commit**
```bash
git add app/src/preload/index.ts app/src/renderer/env.d.ts app/tsconfig.web.json
git commit -m "feat(app): preload window.todl surface + typed bridge global" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Main-process wiring — `SafeStorageEncryptor`, construct the bridge, register IPC, add the vite alias

Connect everything in the main process: the real `safeStorage` encryptor, the stores rooted at `app.getPath("userData")`, the `RegistryBridge` built with the real package-manager symbols, and `ipcMain.handle` for each channel. Add the main-section vite alias so the package-manager VALUE imports resolve to the built `dist` and get bundled into `out/main`.

**Files:**
- Create: `app/src/main/registry/safe-storage-encryptor.ts`
- Create: `app/src/main/registry/register-ipc.ts`
- Modify: `app/src/main/index.ts`
- Modify: `app/electron.vite.config.ts` (main-section alias)
- Modify: `app/tsconfig.node.json` (type path + include already covers `src/main/**`)

**Interfaces:**
- Consumes: `RegistryBridge`, `type RegistryBridgeDeps` (Task 4); `TokenStore` (Task 2); `SettingsStore` (Task 3); `NpmRegistry`, `TarReader`, `resolveClosure` (VALUES) from `@pragmatic-tech-ai/todl/package-manager`.
- Produces: `class SafeStorageEncryptor implements Encryptor`; a `RegistryIpc.register(ipcMain, bridge)` static that maps channels → bridge methods; the app boots with the bridge live.

- [ ] **Step 1: Implement `app/src/main/registry/safe-storage-encryptor.ts`:**

```ts
/**
 * `SafeStorageEncryptor` — the production `Encryptor` for `TokenStore`, backed by
 * Electron's OS-keyring `safeStorage` (design §5). Isolated in its own file so
 * `TokenStore` (and its unit test) never import Electron.
 */
import { safeStorage } from "electron";
import type { Encryptor } from "./token-store.js";

export class SafeStorageEncryptor implements Encryptor {
  available(): boolean {
    return safeStorage.isEncryptionAvailable();
  }
  encrypt(plain: string): Buffer {
    return safeStorage.encryptString(plain);
  }
  decrypt(cipher: Buffer): string {
    return safeStorage.decryptString(cipher);
  }
}
```

- [ ] **Step 2: Implement `app/src/main/registry/register-ipc.ts`** (channel wiring kept out of `index.ts` for clarity; the only place channel strings pair with bridge methods on the main side):

```ts
/**
 * Map the `registry:*` / `config:*` IPC channels onto `RegistryBridge` methods
 * (design §5). Channel names MUST match the preload surface (`preload/index.ts`).
 */
import type { IpcMain } from "electron";
import type { RegistryBridge } from "./registry-bridge.js";

export class RegistryIpc {
  static register(ipcMain: IpcMain, bridge: RegistryBridge): void {
    ipcMain.handle("registry:list", () => bridge.list());
    ipcMain.handle("registry:versions", (_e, name: string) => bridge.versions(name));
    ipcMain.handle("registry:getContent", (_e, ref) => bridge.getContent(ref));
    ipcMain.handle("registry:getPackage", (_e, ref) => bridge.getPackage(ref));
    ipcMain.handle("registry:resolveClosure", (_e, rootDeps: string[]) => bridge.resolveClosure(rootDeps));
    ipcMain.handle("registry:publishDir", (_e, dir: string) => bridge.publishDir(dir));
    ipcMain.handle("config:get", () => bridge.getConfig());
    ipcMain.handle("config:setToken", (_e, token: string) => bridge.setToken(token));
    ipcMain.handle("config:setSettings", (_e, partial) => bridge.setSettings(partial));
  }
}
```

- [ ] **Step 3: Modify `app/src/main/index.ts`** — add imports and construct + register the bridge inside `app.whenReady().then(...)` **before** `createWindow()`. Add these imports at the top:

```ts
import { app, BrowserWindow, ipcMain } from "electron";
import { NpmRegistry, TarReader, resolveClosure } from "@pragmatic-tech-ai/todl/package-manager";
import { TokenStore } from "./registry/token-store.js";
import { SettingsStore } from "./registry/settings-store.js";
import { RegistryBridge } from "./registry/registry-bridge.js";
import { RegistryIpc } from "./registry/register-ipc.js";
import { SafeStorageEncryptor } from "./registry/safe-storage-encryptor.js";
```

(Note the added `ipcMain` on the existing `electron` import line — replace the current `import { app, BrowserWindow } from "electron";`.)

Then change the ready handler body to build the bridge first:

```ts
void app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.pragmatic-tech-ai.todl");

  const userData = app.getPath("userData");
  const bridge = new RegistryBridge({
    tokenStore: new TokenStore(userData, new SafeStorageEncryptor()),
    settingsStore: new SettingsStore(userData),
    createRegistry: (config) => new NpmRegistry(config),
    readPackage: (bytes) => TarReader.readPackage(bytes),
    resolveClosure: (packages, rootDeps) => resolveClosure(packages, rootDeps),
  });
  RegistryIpc.register(ipcMain, bridge);

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
```

- [ ] **Step 4: Add the main-section alias in `app/electron.vite.config.ts`** so the package-manager value imports resolve to the built dist and bundle into `out/main` (externalizeDepsPlugin only externalizes package.json deps, and `@pragmatic-tech-ai/todl` is not one — so the alias wins and the code is bundled). Change the `main` section from `{ plugins: [externalizeDepsPlugin()] }` to:

```ts
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: [
        { find: /^@pragmatic-tech-ai\/todl\/package-manager$/, replacement: resolve(repoRoot, "dist/package-manager/index.js") },
      ],
    },
  },
```

(`repoRoot` and `resolve` are already defined at the top of the file.)

- [ ] **Step 5: Add the type path to `app/tsconfig.node.json`** so `tsc` resolves the value import for the main process. Add `baseUrl` + `paths` to `compilerOptions`:

```json
  "compilerOptions": {
    "composite": true,
    "types": ["electron-vite/node", "node"],
    "baseUrl": ".",
    "paths": { "@pragmatic-tech-ai/todl/package-manager": ["../src/package-manager/index.ts"] }
  }
```

- [ ] **Step 6: Build + verify the package-manager code bundled into main** — `cd TODL && npm run build && npm --prefix app run build`. Then confirm it bundled (not left as an unresolved require): `grep -q "gunzipSync" app/out/main/index.js && echo PM_BUNDLED_OK` (TarReader pulls in `node:zlib`'s `gunzipSync`, which appears in the bundle). If the build errors that `@pragmatic-tech-ai/todl/package-manager` cannot be resolved, the alias regex or `dist/` is missing — ensure `npm run build` ran first (it emits `dist/package-manager/index.js`).

- [ ] **Step 7: Commit**
```bash
git add app/src/main/registry/safe-storage-encryptor.ts app/src/main/registry/register-ipc.ts app/src/main/index.ts app/electron.vite.config.ts app/tsconfig.node.json
git commit -m "feat(app): wire RegistryBridge into main + IPC channels + safeStorage" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Renderer `RegistryClient` — typed wrapper over `window.todl`

A typed service so renderer page VMs (SP3) never touch the `window.todl` global directly. Thin pass-through today; the seam is where any future byte/shape conversion lives. Unit-tested against a stubbed global.

**Files:**
- Create: `app/src/renderer/services/registry-client.ts`
- Create: `app/src/renderer/services/tests/registry-client.test.ts`

**Interfaces:**
- Consumes: the `window.todl` global (typed via `env.d.ts`, Task 5); `type PackageRef`, `type VersionList`, `type InstalledPackage`, `type ResolvedClosure` from `@pragmatic-tech-ai/todl/package-manager`; `type ConfigView` from `../../main/registry/registry-bridge.js` (type-only).
- Produces: `class RegistryClient` with `list()`, `versions(name)`, `getContent(ref)`, `getPackage(ref)`, `resolveClosure(rootDeps)`, `getConfig()`, `setToken(token)`, `setSettings(partial)`. Consumed by SP3 page VMs.

- [ ] **Step 1: Write the failing test** — `app/src/renderer/services/tests/registry-client.test.ts` (stubs `globalThis.window`; no jsdom needed):

```ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { RegistryClient } from "../registry-client.js";

const calls: Array<[string, unknown[]]> = [];
function stubWindow(overrides: Record<string, (...a: any[]) => any> = {}) {
  const record = (name: string) => (...args: any[]) => {
    calls.push([name, args]);
    return overrides[name]?.(...args) ?? Promise.resolve(undefined);
  };
  (globalThis as any).window = {
    todl: {
      registry: { list: record("list"), versions: record("versions"), getContent: record("getContent"), getPackage: record("getPackage"), resolveClosure: record("resolveClosure"), publishDir: record("publishDir") },
      config: { get: record("get"), setToken: record("setToken"), setSettings: record("setSettings") },
    },
  };
}
afterEach(() => {
  calls.length = 0;
  delete (globalThis as any).window;
});

test("list forwards to window.todl.registry.list and returns its result", async () => {
  stubWindow({ list: () => Promise.resolve(["aws"]) });
  assert.deepEqual(await new RegistryClient().list(), ["aws"]);
  assert.deepEqual(calls[0], ["list", []]);
});

test("versions/getPackage/resolveClosure forward their arguments", async () => {
  stubWindow();
  const client = new RegistryClient();
  await client.versions("microsoft");
  await client.getPackage({ name: "aws" });
  await client.resolveClosure(["@pragmatic-tech-ai/aws"]);
  assert.deepEqual(calls.map((c) => c[0]), ["versions", "getPackage", "resolveClosure"]);
  assert.deepEqual(calls[0]![1], ["microsoft"]);
  assert.deepEqual(calls[1]![1], [{ name: "aws" }]);
  assert.deepEqual(calls[2]![1], [["@pragmatic-tech-ai/aws"]]);
});

test("getConfig / setToken / setSettings forward to the config namespace", async () => {
  stubWindow({ get: () => Promise.resolve({ registry: "r", scope: "@s", org: "o", hasToken: true }) });
  const client = new RegistryClient();
  assert.deepEqual(await client.getConfig(), { registry: "r", scope: "@s", org: "o", hasToken: true });
  await client.setToken("ghp_x");
  await client.setSettings({ org: "acme" });
  assert.deepEqual(calls.map((c) => c[0]), ["get", "setToken", "setSettings"]);
  assert.deepEqual(calls[1]![1], ["ghp_x"]);
});
```

- [ ] **Step 2: Run RED** — `npm --prefix app test` → FAIL (`Cannot find module '../registry-client.js'`).

- [ ] **Step 3: Implement `app/src/renderer/services/registry-client.ts`:**

```ts
/**
 * `RegistryClient` — a typed wrapper over the `window.todl` bridge (design §5) so
 * renderer VMs depend on this class, not the global. Thin pass-through today; the
 * seam is where transferred-byte or shape conversion would live. IPC (structured
 * clone) preserves `Uint8Array`, so `getContent` needs no conversion yet.
 */
import type {
  PackageRef,
  VersionList,
  InstalledPackage,
  ResolvedClosure,
} from "@pragmatic-tech-ai/todl/package-manager";
import type { ConfigView } from "../../main/registry/registry-bridge.js";

export class RegistryClient {
  list(): Promise<string[]> {
    return window.todl.registry.list();
  }
  versions(name: string): Promise<VersionList> {
    return window.todl.registry.versions(name);
  }
  getContent(ref: PackageRef): Promise<Uint8Array> {
    return window.todl.registry.getContent(ref);
  }
  getPackage(ref: PackageRef): Promise<InstalledPackage> {
    return window.todl.registry.getPackage(ref);
  }
  resolveClosure(rootDeps: string[]): Promise<ResolvedClosure> {
    return window.todl.registry.resolveClosure(rootDeps);
  }
  getConfig(): Promise<ConfigView> {
    return window.todl.config.get();
  }
  setToken(token: string): Promise<void> {
    return window.todl.config.setToken(token);
  }
  setSettings(partial: Partial<{ registry: string; scope: string; org: string; githubApi: string }>): Promise<void> {
    return window.todl.config.setSettings(partial);
  }
}
```

- [ ] **Step 4: Run GREEN** — `npm --prefix app test` → all RegistryClient tests PASS (whole app unit suite green).

- [ ] **Step 5: Commit**
```bash
git add app/src/renderer/services/registry-client.ts app/src/renderer/services/tests/registry-client.test.ts
git commit -m "feat(app): renderer RegistryClient over the window.todl bridge" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end bridge round-trip smoke (Playwright `_electron`)

The SP2 "done when": a renderer call round-trips through the bridge. Use `config:get` — it exercises renderer → preload → `ipcMain` → `SettingsStore`/`TokenStore` → back, **without network or a token**, so it is deterministic in CI. (A live registry round-trip needs a token and is a manual step, per design §8.)

**Files:** Create `app/tests/smoke/registry-bridge.spec.ts`

**Interfaces:** Consumes the built `app/out/main/index.js` (Task 6) and the `window.todl` surface (Task 5).

- [ ] **Step 1: Write the test** — `app/tests/smoke/registry-bridge.spec.ts`:

```ts
import { test, expect, _electron as electron } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

test("config.get round-trips renderer -> preload -> ipcMain -> stores -> renderer", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"]; // else Electron runs as plain Node (known gotcha)

  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 }); // renderer mounted

  const config = await window.evaluate(() => window.todl.config.get());
  expect(config).toMatchObject({
    registry: "https://npm.pkg.github.com",
    scope: "@pragmatic-tech-ai",
    org: "pragmatic-tech-ai",
    hasToken: false, // fresh userData → no token; and the token value is never exposed
  });
  expect(config).not.toHaveProperty("token");

  await app.close();
});
```

- [ ] **Step 2: RED** — `rm -rf app/out && npm --prefix app run test:e2e` → FAIL (no `out/main/index.js`, or `window.todl.config` undefined). Capture as RED evidence.

- [ ] **Step 3: GREEN** — `cd TODL && npm run build && npm --prefix app run build && npm --prefix app run test:e2e` → PASS. Do not weaken the assertions to force a pass; if `config.get()` rejects or returns the wrong shape, debug the wiring (Task 6) and report BLOCKED if genuinely stuck. Note: the fresh-`userData` `hasToken:false` assumes no prior token was written on this machine's TODL app userData; if a developer previously set one, run against a clean profile (`electron.launch({ args: [mainEntry, "--user-data-dir=<tmp>"], env })`) — add that arg if the assertion flakes.

- [ ] **Step 4: Commit**
```bash
git add app/tests/smoke/registry-bridge.spec.ts
git commit -m "test(app): SP2 bridge round-trip smoke (config.get)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage (SP2 §5 + tar reader + §7):**
- Tar reader (`untar.ts` in the design) → Task 1 `TarReader` (class per OOP rule; `read` + `readPackage`, round-trip tested against `createTgz`) ✓
- `TokenStore` (safeStorage, `hasToken` semantics, encrypt-at-rest, unavailable-fallback) → Tasks 2 + 6 ✓
- `SettingsStore` (registry/scope/org/githubApi in `userData`, defaults) → Task 3 ✓
- Main-process registry from resolved config + token → Task 6 (`createRegistry: new NpmRegistry(config)`, config from settings+token) ✓
- IPC channels `registry:{list,versions,getContent,getPackage,resolveClosure,publishDir}` + `config:{get,setToken,setSettings}` → `RegistryBridge` (Task 4) + `RegistryIpc` (Task 6) + preload (Task 5) ✓ — every design channel present.
- Preload surface `window.todl` (typed, no `ipcRenderer` leak) → Task 5 ✓
- Renderer client `registry-client.ts` (byte handling seam) → Task 7 ✓
- Security §7 (`contextIsolation`/`nodeIntegration` unchanged; token only in main; `config:get` returns `hasToken`, never token) → Global Constraints + Tasks 4/8 (asserted) ✓
- Testing §8 (tar reader unit; stores over temp userData; handlers pure over injected deps; renderer client vs stubbed global; live/e2e manual) → Tasks 1–8 ✓
- Done-when: renderer call round-trips through the bridge → Task 8 ✓

**2. Placeholder scan:** every code step contains the full file/edit. No TBD/TODO. The one intentional deviation from the design (a `TarReader` class rather than a free `untar`/`readPackageBytes`) is called out in Global Constraints + Task 1 rationale, per the workspace OOP rule.

**3. Type/name consistency:** channel strings identical across preload (Task 5) and `RegistryIpc` (Task 6): `registry:list|versions|getContent|getPackage|resolveClosure|publishDir`, `config:get|setToken|setSettings`. `RegistryBridge` method names (`list/versions/getContent/getPackage/resolveClosure/publishDir/getConfig/setToken/setSettings`) match the `RegistryIpc` mapping and the `RegistryClient` forwards (client uses `getConfig` → `config:get`, consistent). `Encryptor` interface defined in `token-store.ts` (Task 2), implemented by `FakeEncryptor`/`PlainEncryptor` (tests) and `SafeStorageEncryptor` (Task 6). `RegistryLike`/`RegistryBridgeDeps`/`ConfigView` defined in `registry-bridge.ts` (Task 4) and reused by tests + `env.d.ts` + `RegistryClient`. `TarReader.readPackage` (Task 1) is what Task 6 injects as `readPackage`. `resolveClosure(packages, rootDeps)` signature matches the core `resolve.ts` export. The `@pragmatic-tech-ai/todl/package-manager` specifier is: exported from `package.json` (Task 1 Step 6), type-path'd in `tsconfig.web.json` (Task 5) and `tsconfig.node.json` (Task 6), and vite-aliased in the main section (Task 6) — the only place it is a value import (`main/index.ts`).
</content>
</invoke>
