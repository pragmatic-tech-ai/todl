# TODL App Electron — SP4: Setup Page + Leftovers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Setup** page where the user configures the registry connection and the auth token — either a stored (encrypted) token or a pick from a ComboBox of the OS environment variables — plus finish the remaining backlog: kind badges on the Packages master list, a **Publish** page (publish a local project dir), auto-update wiring, and a documented live-token smoke.

**Architecture:** Extend the SP2 main-process token model with a **token source** (`Stored` | `Env`): `SettingsStore` records the source + env-var name (not a secret); `RegistryBridge` resolves the effective token per request from either the encrypted `TokenStore` or an injected `env` map, and exposes `listEnvVars`/`setStoredToken`/`useEnvToken` + an extended `config:get`. New MuralBase pages (`SetupVM`, `PublishVM`) mirror the existing page pattern; the Packages page drops its inline token field and points to Setup. Kind badges use a cheap `NpmRegistry.getManifest` (packument read, no tarball download). Publish uses a native directory picker (`dialog:pickDirectory`). Auto-update mirrors Plexus's guarded `electron-updater` wiring, inert until a release repo exists.

**Tech Stack:** Mural (`MuralBase`, `RegisterProperty`, `RelayCommand`, `ComboBox`, `TextBox`, `Visibility`), the SP2 bridge/stores/client, `NpmRegistry` (core), Electron `dialog` + `safeStorage`, `electron-updater`, `tsx --test` (backend logic), `@playwright/test` `_electron` (pages via injected `__todlBridge`).

**Spec:** Continues `docs/superpowers/specs/2026-09-04-todl-app-electron-package-manager-design.md` (§9 deferred items) + SP2/SP3 plans. The token-source model + env-var ComboBox is a new requirement from the user (not in the original design).

## Global Constraints

- **Token never crosses to the renderer** (unchanged): `config:get` returns `hasToken` + `tokenSource` + `tokenEnvVar` (the env var *name* is not secret), never a token value. Stored tokens stay `safeStorage`-encrypted; env tokens are read from `process.env` in main at request time and never persisted.
- **Enums, not string-literal unions** (workspace rule): the token source is a real `enum TokenSource`.
- **OOP, no free functions** (workspace rule). Page VMs extend `MuralBase` (DP case); `RegistryClient` is the renderer's only door to `window.todl`, read via its `bridge()` seam (`__todlBridge ?? window.todl` — SP3).
- **MuralBase VMs are not `tsx`-testable** (SP3): new VMs are verified by the Playwright e2e; only backend/plain logic (`RegistryBridge`, `SettingsStore`, `RegistryClient`, `NpmRegistry`, the updater guard) is `tsx`-unit-tested.
- **Package-manager VALUE imports only in `app/src/main/index.ts`** (SP2). Elsewhere `import type` only.
- **Env-var enumeration lists all `process.env` keys, sorted.** The ComboBox may be long; that is the requested behavior.
- **Tests** live in `tests/` subfolders. **Commits** on a new branch `feat/app-setup-leftovers` from `main`; stage per task; **never `git push`**.

---

### Task 0: Branch

- [ ] **Step 1:** `git -C TODL status -sb` clean on `main`.
- [ ] **Step 2:** `git -C TODL checkout -b feat/app-setup-leftovers`
- [ ] **Step 3:** `git -C TODL branch --show-current` → `feat/app-setup-leftovers`.

---

### Task 1: Token-source model in `SettingsStore` + `RegistryBridge`

Add `TokenSource` + `tokenEnvVar` to settings, an injected `env`, effective-token resolution, `listEnvVars`, `setStoredToken`, `useEnvToken`, and an extended `ConfigView`. Rename the bridge's `setToken` → `setStoredToken`.

**Files:**
- Modify: `app/src/main/registry/settings-store.ts` (+ `TokenSource`, `tokenSource`, `tokenEnvVar`)
- Modify: `app/src/main/registry/tests/settings-store.test.ts`
- Modify: `app/src/main/registry/registry-bridge.ts`
- Modify: `app/src/main/registry/tests/registry-bridge.test.ts`

**Interfaces:**
- Produces: `enum TokenSource { Stored = "stored", Env = "env" }`; `RegistrySettings` gains `tokenSource: TokenSource` + `tokenEnvVar: string`. `ConfigView` gains `tokenSource: TokenSource` + `tokenEnvVar: string`. `RegistryBridgeDeps` gains `env: Record<string, string | undefined>`. `RegistryBridge`: `listEnvVars(): Promise<string[]>`, `setStoredToken(token): Promise<void>`, `useEnvToken(varName): Promise<void>` (replaces `setToken`), private `effectiveToken()`.

- [ ] **Step 1: SettingsStore** — replace the top of `settings-store.ts` with the enum + extended shape/defaults:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where the auth token comes from. */
export enum TokenSource {
  Stored = "stored",
  Env = "env",
}

export interface RegistrySettings {
  registry: string;
  scope: string;
  org: string;
  githubApi: string;
  tokenSource: TokenSource;
  /** The env-var name holding the token when `tokenSource === Env`. */
  tokenEnvVar: string;
}

const SETTINGS_FILE = "registry-settings.json";
const DEFAULTS: RegistrySettings = {
  registry: "https://npm.pkg.github.com",
  scope: "@pragmatic-tech-ai",
  org: "pragmatic-tech-ai",
  githubApi: "https://api.github.com",
  tokenSource: TokenSource.Stored,
  tokenEnvVar: "",
};
```

(The `SettingsStore` class body below is unchanged.)

- [ ] **Step 2: SettingsStore test** — update the defaults assertion in `settings-store.test.ts` to include the two new fields:

```ts
  assert.deepEqual(new SettingsStore(freshDir()).get(), {
    registry: "https://npm.pkg.github.com",
    scope: "@pragmatic-tech-ai",
    org: "pragmatic-tech-ai",
    githubApi: "https://api.github.com",
    tokenSource: "stored",
    tokenEnvVar: "",
  });
```

Add a test:

```ts
test("update persists tokenSource + tokenEnvVar", () => {
  const dir = freshDir();
  new SettingsStore(dir).update({ tokenSource: TokenSource.Env, tokenEnvVar: "GH_PAT" });
  const s = new SettingsStore(dir).get();
  assert.equal(s.tokenSource, "env");
  assert.equal(s.tokenEnvVar, "GH_PAT");
});
```

Add `TokenSource` to the import at the top of the test.

- [ ] **Step 3: Run RED** — `npm --prefix app test` → settings defaults test fails (missing fields) until Step 1 is saved; save Step 1 first so this is GREEN, then the bridge changes below drive the next RED. (Order: apply Steps 1–2 together, run — settings tests pass.)

- [ ] **Step 4: RegistryBridge** — edits:
  - Import `TokenSource` (value) — but the bridge must stay Electron-free and package-manager-type-only; `TokenSource` comes from `./settings-store.js` (local, fine as a value import): add `import { TokenSource } from "./settings-store.js";` and `import type { RegistrySettings } from "./settings-store.js";`
  - Extend `ConfigView`:

```ts
export interface ConfigView {
  registry: string;
  scope: string;
  org: string;
  tokenSource: TokenSource;
  tokenEnvVar: string;
  hasToken: boolean;
}
```

  - Add to `RegistryBridgeDeps` (after `readFiles`): `/** The process environment, for env-var tokens (prod: `process.env`). */ env: Record<string, string | undefined>;`
  - Replace `getConfig`, `setToken`, and `registry()` and add the new methods:

```ts
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

  /** The effective token for the current source: the env var's value, or the
   *  stored (encrypted) token. */
  private effectiveToken(settings: RegistrySettings = this.deps.settingsStore.get()): string {
    if (settings.tokenSource === TokenSource.Env) {
      return this.deps.env[settings.tokenEnvVar] ?? "";
    }
    return this.deps.tokenStore.getToken();
  }

  private registry(): RegistryLike {
    const s = this.deps.settingsStore.get();
    return this.deps.createRegistry({
      registry: s.registry,
      scope: s.scope,
      org: s.org,
      githubApi: s.githubApi,
      token: this.effectiveToken(s),
    });
  }
```

  (Remove the old `setToken` method and the old `registry()`/`getConfig()`.)

- [ ] **Step 5: RegistryBridge test** — in `registry-bridge.test.ts`: add `env: {}` to `makeBridge`'s `new RegistryBridge({...})` and to the inline bridge in the "setSettings" test; add an `env` parameter to `makeBridge`:

```ts
function makeBridge(
  registry: RegistryLike,
  readPackage = () => undefined as any,
  resolve = () => ({}) as any,
  readFiles: (bytes: Uint8Array) => { path: string; bytes: Uint8Array }[] = () => [],
  env: Record<string, string | undefined> = {},
) {
  const dir = freshDir();
  return new RegistryBridge({
    tokenStore: new TokenStore(dir, new PlainEncryptor()),
    settingsStore: new SettingsStore(dir),
    createRegistry: () => registry,
    readPackage,
    resolveClosure: resolve,
    readFiles,
    env,
  });
}
```

  Update the existing "getConfig reports settings + hasToken" test: it calls `bridge.setToken("ghp_x")` → rename to `bridge.setStoredToken("ghp_x")`. Add:

```ts
test("env-var token: hasToken reflects process.env and never the value", async () => {
  const dir = freshDir();
  const bridge = new RegistryBridge({
    tokenStore: new TokenStore(dir, new PlainEncryptor()),
    settingsStore: new SettingsStore(dir),
    createRegistry: () => new FakeRegistry([], new Map()),
    readPackage: () => undefined as any,
    resolveClosure: () => ({}) as any,
    readFiles: () => [],
    env: { GH_PAT: "ghp_fromenv" },
  });
  await bridge.useEnvToken("GH_PAT");
  const cfg = await bridge.getConfig();
  assert.equal(cfg.tokenSource, "env");
  assert.equal(cfg.tokenEnvVar, "GH_PAT");
  assert.equal(cfg.hasToken, true);
  assert.ok(!("token" in cfg));
  // Missing var → no token.
  await bridge.useEnvToken("NOPE");
  assert.equal((await bridge.getConfig()).hasToken, false);
});

test("listEnvVars returns sorted defined env keys", async () => {
  const bridge = makeBridge(new FakeRegistry([], new Map()), undefined, undefined, undefined, { B: "1", A: "2", C: undefined });
  assert.deepEqual(await bridge.listEnvVars(), ["A", "B"]);
});
```

- [ ] **Step 6: Run GREEN** — `npm --prefix app test` → all pass.

- [ ] **Step 7: Commit**
```bash
git add app/src/main/registry/settings-store.ts app/src/main/registry/tests/settings-store.test.ts app/src/main/registry/registry-bridge.ts app/src/main/registry/tests/registry-bridge.test.ts
git commit -m "feat(app): token-source model (stored | env var) in settings + bridge" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `NpmRegistry.getManifest` (core) — cheap kind lookup

Read a package's resolved version manifest (which includes the published `todl` block) from the packument — no tarball download. Powers kind badges without fetching every tarball.

**Files:**
- Modify: `src/package-manager/registry/npm-registry.ts`
- Modify: `src/package-manager/registry/tests/npm-registry.test.ts`

**Interfaces:** Produces `NpmRegistry.getManifest(ref: PackageRef): Promise<PackageManifestJson>` (the published version manifest, incl. any `todl` block). Consumed by the bridge's `getMeta` (Task 3).

- [ ] **Step 1: Test** — in `npm-registry.test.ts`, add (the FakeRegistry already stores the full version manifest from `publish`, which includes extra fields passed through):

```ts
test("getManifest returns the published version manifest incl. the todl block", async () => {
  const registry = client(new FakeRegistry());
  const tar = createTgz([{ path: "package/a", bytes: enc.encode("a") }]);
  await registry.publish({ name: `${SCOPE}/aws`, version: "0.1.0", todl: { kind: "library", id: "aws" } } as any, tar);
  const manifest = await registry.getManifest({ name: "aws" });
  assert.equal(manifest.version, "0.1.0");
  assert.deepEqual((manifest as any).todl, { kind: "library", id: "aws" });
});
```

- [ ] **Step 2: Run RED** — `npx tsx --test src/package-manager/registry/tests/npm-registry.test.ts` → the new test fails (`getManifest is not a function`). (Note: `FakeRegistry.put` stores `versions[v]` = the version object incl. `todl`, and `getPackument` returns it — so the packument carries the manifest.)

- [ ] **Step 3: Implement** — in `npm-registry.ts`, widen the `Packument` version type to carry arbitrary manifest fields and add the method. Change the `Packument` interface's `versions` value type to `Record<string, PackageManifestJson & { dist?: { tarball?: string; integrity?: string } }>`, then add after `getContent`:

```ts
  /** Read a package's resolved version manifest from the packument (no tarball
   *  download). Includes any published fields such as the `todl` block. */
  async getManifest(ref: PackageRef): Promise<PackageManifestJson> {
    const name = this.qualify(ref);
    const packument = await this.packument(name);
    const version = this.resolveVersion(packument, name, ref.version);
    const manifest = packument.versions?.[version];
    if (manifest === undefined) throw new Error(`no manifest for ${name}@${version}`);
    return manifest;
  }
```

- [ ] **Step 4: Run GREEN** — `npx tsx --test "src/package-manager/**/*.test.ts"` → all pass.

- [ ] **Step 5: Commit**
```bash
git add src/package-manager/registry/npm-registry.ts src/package-manager/registry/tests/npm-registry.test.ts
git commit -m "feat(package-manager): NpmRegistry.getManifest — packument version manifest" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Bridge `getMeta` + `pickDirectory` + publish/config channels + preload + client

Wire the new capabilities across the IPC surface: `getMeta` (kind), `pickDirectory` (native dialog), and expose `publishDir` on the client. Add all channels, preload wrappers, the typed surface, main injection, and client methods.

**Files:**
- Modify: `app/src/main/registry/registry-bridge.ts` (add `getMeta` + `getManifest` dep)
- Modify: `app/src/main/registry/tests/registry-bridge.test.ts`
- Modify: `app/src/main/registry/register-ipc.ts` (channels: `registry:getMeta`, `config:setToken`→setStoredToken, `config:useEnvToken`, `config:envVars`, `dialog:pickDirectory`)
- Modify: `app/src/main/index.ts` (inject `env`, `getManifest`, `pickDirectory`)
- Modify: `app/src/preload/index.ts`
- Modify: `app/src/renderer/env.d.ts`
- Modify: `app/src/renderer/services/registry-client.ts`
- Modify: `app/src/renderer/services/tests/registry-client.test.ts`

**Interfaces:**
- Produces: `RegistryBridgeDeps.getManifest(ref): Promise<{ todl?: { kind: string; id: string } }>` + `RegistryBridge.getMeta(name): Promise<string>` (the kind, or `""`). A `pickDirectory` is a main-only concern injected into `RegistryIpc` (not the bridge). `RegistryClient` gains `setStoredToken`, `useEnvToken`, `listEnvVars`, `getMeta`, `publishDir`, `pickDirectory`.

- [ ] **Step 1: Bridge `getMeta`** — in `registry-bridge.ts`, add to `RegistryBridgeDeps`: `/** Read a package's version manifest (prod: `NpmRegistry.getManifest`). */ getManifest(ref: PackageRef): Promise<{ todl?: { kind: string; id: string } }>;` and the method:

```ts
  async getMeta(name: string): Promise<string> {
    const manifest = await this.deps.getManifest({ name });
    return manifest.todl?.kind ?? "";
  }
```

  Update `makeBridge` in the test to pass `getManifest: async () => ({ todl: { kind: "library", id: "x" } })` (add param with that default) and add:

```ts
test("getMeta returns the package kind from its manifest", async () => {
  const bridge = makeBridge(new FakeRegistry(["aws"], new Map()));
  assert.equal(await bridge.getMeta("aws"), "library");
});
```

  (Add `getManifest` to the inline bridge in the "setSettings" test too.)

- [ ] **Step 2: RED/GREEN bridge** — `npm --prefix app test` red then, after Step 1's impl, green.

- [ ] **Step 3: register-ipc** — rewrite the `config:*` block + add channels. `RegistryIpc.register` gains a `pickDirectory` collaborator:

```ts
import type { IpcMain } from "electron";
import type { RegistryBridge } from "./registry-bridge.js";

export class RegistryIpc {
  static register(ipcMain: IpcMain, bridge: RegistryBridge, pickDirectory: () => Promise<string>): void {
    ipcMain.handle("registry:list", () => bridge.list());
    ipcMain.handle("registry:versions", (_e, name: string) => bridge.versions(name));
    ipcMain.handle("registry:getContent", (_e, ref) => bridge.getContent(ref));
    ipcMain.handle("registry:getPackage", (_e, ref) => bridge.getPackage(ref));
    ipcMain.handle("registry:getMeta", (_e, name: string) => bridge.getMeta(name));
    ipcMain.handle("registry:resolveClosure", (_e, rootDeps: string[]) => bridge.resolveClosure(rootDeps));
    ipcMain.handle("registry:publishDir", (_e, dir: string) => bridge.publishDir(dir));
    ipcMain.handle("registry:getSources", (_e, ref) => bridge.getSources(ref));
    ipcMain.handle("config:get", () => bridge.getConfig());
    ipcMain.handle("config:setToken", (_e, token: string) => bridge.setStoredToken(token));
    ipcMain.handle("config:useEnvToken", (_e, name: string) => bridge.useEnvToken(name));
    ipcMain.handle("config:envVars", () => bridge.listEnvVars());
    ipcMain.handle("config:setSettings", (_e, partial) => bridge.setSettings(partial));
    ipcMain.handle("dialog:pickDirectory", () => pickDirectory());
  }
}
```

- [ ] **Step 4: main/index.ts** — inject `env`, `getManifest`, build a `NpmRegistry` reused for `getManifest`? No — the bridge builds its own registry per call; `getManifest` needs a registry too. Add `getManifest` via the same `createRegistry`: simplest is to give the bridge dep as a closure over a fresh registry using current config. But the bridge's private `registry()` already builds one; `getManifest` should use it. **Refinement:** make `getManifest` a bridge method that uses `this.registry().getManifest(...)` rather than an injected dep — but `RegistryLike` doesn't include `getManifest`. Add `getManifest` to `RegistryLike` and drop the injected `getManifest` dep. Revise:
  - In `registry-bridge.ts`: add to `RegistryLike`: `getManifest(ref: PackageRef): Promise<{ todl?: { kind: string; id: string } }>;`; change `getMeta` to `const m = await this.registry().getManifest({ name }); return m.todl?.kind ?? "";`; remove the `getManifest` dep from `RegistryBridgeDeps`.
  - In the test: `FakeRegistry` implements `getManifest(ref)` returning `{ todl: { kind: "library", id: "aws" } }`.
  - In `main/index.ts`, add `env: process.env` to the deps and register IPC with a picker:

```ts
import { app, BrowserWindow, ipcMain, dialog } from "electron";
...
    readFiles: (bytes) => TarReader.read(bytes),
    env: process.env,
  });
  RegistryIpc.register(ipcMain, bridge, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled || result.filePaths.length === 0 ? "" : result.filePaths[0]!;
  });
```

  (Apply the `RegistryLike.getManifest` refinement now; re-run `npm --prefix app test` to keep bridge tests green — the `FakeRegistry` must gain `getManifest`.)

- [ ] **Step 5: preload** — add to `registry`: `getMeta: (name: string) => ipcRenderer.invoke("registry:getMeta", name)`; add a top-level `config.useEnvToken`, `config.listEnvVars`, and a `dialog` namespace:

```ts
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    setToken: (token: string) => ipcRenderer.invoke("config:setToken", token),
    useEnvToken: (name: string) => ipcRenderer.invoke("config:useEnvToken", name),
    listEnvVars: () => ipcRenderer.invoke("config:envVars"),
    setSettings: (partial: unknown) => ipcRenderer.invoke("config:setSettings", partial),
  },
  dialog: {
    pickDirectory: () => ipcRenderer.invoke("dialog:pickDirectory"),
  },
```

- [ ] **Step 6: env.d.ts** — extend `TodlBridge`: add `getMeta(name: string): Promise<string>` to `registry`; add `useEnvToken(name: string): Promise<void>` + `listEnvVars(): Promise<string[]>` to `config`; add `dialog: { pickDirectory(): Promise<string> }`.

- [ ] **Step 7: client + test** — in `registry-client.ts` add: `getMeta(name)`, `useEnvToken(name)`, `listEnvVars()`, `publishDir(dir)`, `pickDirectory()`, and rename `setToken` → `setStoredToken` (calls `config.setToken`). In the client test: add these to the stub (`getMeta`, `useEnvToken`, `listEnvVars` under registry/config; `dialog: { pickDirectory: record("pickDirectory") }`) and rename the `setToken` forward assertion to `setStoredToken`.

```ts
  getMeta(name: string): Promise<string> {
    return this.bridge().registry.getMeta(name);
  }
  publishDir(dir: string): Promise<void> {
    return this.bridge().registry.publishDir(dir);
  }
  setStoredToken(token: string): Promise<void> {
    return this.bridge().config.setToken(token);
  }
  useEnvToken(name: string): Promise<void> {
    return this.bridge().config.useEnvToken(name);
  }
  listEnvVars(): Promise<string[]> {
    return this.bridge().config.listEnvVars();
  }
  pickDirectory(): Promise<string> {
    return this.bridge().dialog.pickDirectory();
  }
```

  (Remove the old `setToken` method.)

- [ ] **Step 8: GREEN + build** — `npm --prefix app test` all pass; `cd TODL && npm run build && npm --prefix app run build` succeeds; `grep -qE "registry:getMeta|dialog:pickDirectory|config:useEnvToken" app/out/preload/index.js && echo PRELOAD_OK`.

- [ ] **Step 9: Commit**
```bash
git add app/src/main/registry/registry-bridge.ts app/src/main/registry/tests/registry-bridge.test.ts app/src/main/registry/register-ipc.ts app/src/main/index.ts app/src/preload/index.ts app/src/renderer/env.d.ts app/src/renderer/services/registry-client.ts app/src/renderer/services/tests/registry-client.test.ts
git commit -m "feat(app): bridge getMeta + pickDirectory + env-token/publish channels" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `SetupVM` + `setup.mu`

The Setup page: editable connection settings (registry/scope/org), a token section with a stored-token field **and** an env-var ComboBox (populated from `listEnvVars`), a save action per mode, and a live status line.

**Files:**
- Create: `app/src/renderer/pages/setup/setup-vm.ts`
- Create: `app/src/renderer/pages/setup/setup.mu`

**Interfaces:** Consumes `RegistryClient`. Produces `class SetupVM` (`new SetupVM(client)`) with DPs `Registry`, `Scope`, `Org`, `TokenInput`, `EnvVars: string[]`, `SelectedEnvVar`, `Status`, commands `SaveSettings`, `SaveToken`, `UseEnv`, `ClearToken`, and `load(): Promise<void>`.

- [ ] **Step 1: Create `app/src/renderer/pages/setup/setup-vm.ts`:**

```ts
import { MuralBase, MetaData, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { RegistryClient } from "../../services/registry-client.js";

/** The Setup page: registry connection + auth token (stored, or an env-var pick). */
export class SetupVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(SetupVM, "Title", "Setup", MetaData.None);
  static RegistryKey = MuralBase.RegisterProperty<string>(SetupVM, "Registry", "", MetaData.None);
  static ScopeKey = MuralBase.RegisterProperty<string>(SetupVM, "Scope", "", MetaData.None);
  static OrgKey = MuralBase.RegisterProperty<string>(SetupVM, "Org", "", MetaData.None);
  static TokenInputKey = MuralBase.RegisterProperty<string>(SetupVM, "TokenInput", "", MetaData.None);
  static EnvVarsKey = MuralBase.RegisterProperty<string[]>(SetupVM, "EnvVars", [], MetaData.None);
  static SelectedEnvVarKey = MuralBase.RegisterProperty<string | undefined>(SetupVM, "SelectedEnvVar", undefined, MetaData.None);
  static StatusKey = MuralBase.RegisterProperty<string>(SetupVM, "Status", "", MetaData.None);
  static SaveSettingsKey = MuralBase.RegisterProperty<ICommand | undefined>(SetupVM, "SaveSettings", undefined, MetaData.None);
  static SaveTokenKey = MuralBase.RegisterProperty<ICommand | undefined>(SetupVM, "SaveToken", undefined, MetaData.None);
  static UseEnvKey = MuralBase.RegisterProperty<ICommand | undefined>(SetupVM, "UseEnv", undefined, MetaData.None);
  static ClearTokenKey = MuralBase.RegisterProperty<ICommand | undefined>(SetupVM, "ClearToken", undefined, MetaData.None);

  get Title(): string { return this.get_property_value(SetupVM.TitleKey); }
  get Registry(): string { return this.get_property_value(SetupVM.RegistryKey); }
  get Scope(): string { return this.get_property_value(SetupVM.ScopeKey); }
  get Org(): string { return this.get_property_value(SetupVM.OrgKey); }
  get TokenInput(): string { return this.get_property_value(SetupVM.TokenInputKey); }
  get EnvVars(): string[] { return this.get_property_value(SetupVM.EnvVarsKey); }
  get SelectedEnvVar(): string | undefined { return this.get_property_value(SetupVM.SelectedEnvVarKey); }
  get Status(): string { return this.get_property_value(SetupVM.StatusKey); }
  get SaveSettings(): ICommand | undefined { return this.get_property_value(SetupVM.SaveSettingsKey); }
  get SaveToken(): ICommand | undefined { return this.get_property_value(SetupVM.SaveTokenKey); }
  get UseEnv(): ICommand | undefined { return this.get_property_value(SetupVM.UseEnvKey); }
  get ClearToken(): ICommand | undefined { return this.get_property_value(SetupVM.ClearTokenKey); }

  constructor(private readonly client: RegistryClient) {
    super();
    this.set_property_value(SetupVM.SaveSettingsKey, new RelayCommand(() => void this.saveSettings()));
    this.set_property_value(SetupVM.SaveTokenKey, new RelayCommand(() => void this.saveToken()));
    this.set_property_value(SetupVM.UseEnvKey, new RelayCommand(() => void this.useEnv()));
    this.set_property_value(SetupVM.ClearTokenKey, new RelayCommand(() => void this.clearToken()));
  }

  async load(): Promise<void> {
    const [config, envVars] = await Promise.all([this.client.getConfig(), this.client.listEnvVars()]);
    this.set_property_value(SetupVM.RegistryKey, config.registry);
    this.set_property_value(SetupVM.ScopeKey, config.scope);
    this.set_property_value(SetupVM.OrgKey, config.org);
    this.set_property_value(SetupVM.EnvVarsKey, envVars);
    if (config.tokenEnvVar) this.set_property_value(SetupVM.SelectedEnvVarKey, config.tokenEnvVar);
    this.refreshStatus(config.tokenSource, config.tokenEnvVar, config.hasToken);
  }

  private refreshStatus(source: string, envVar: string, hasToken: boolean): void {
    const where = source === "env" ? `env var "${envVar || "(none)"}"` : "stored token";
    this.set_property_value(SetupVM.StatusKey, `Token source: ${where} — ${hasToken ? "resolved ✓" : "not set ✗"}`);
  }

  private async saveSettings(): Promise<void> {
    await this.client.setSettings({ registry: this.Registry, scope: this.Scope, org: this.Org });
    await this.load();
  }

  private async saveToken(): Promise<void> {
    await this.client.setStoredToken(this.TokenInput);
    this.set_property_value(SetupVM.TokenInputKey, "");
    await this.load();
  }

  private async useEnv(): Promise<void> {
    if (!this.SelectedEnvVar) return;
    await this.client.useEnvToken(this.SelectedEnvVar);
    await this.load();
  }

  private async clearToken(): Promise<void> {
    await this.client.setStoredToken("");
    await this.load();
  }
}
```

- [ ] **Step 2: Create `app/src/renderer/pages/setup/setup.mu`:**

```
import SetupVM from "./setup-vm.ts"

resources Setup {
    DataTemplate [DataType = SetupVM] {
        StackPanel [ Orientation = Vertical, Margin = (16,16,16,16) ] {
            TextBlock [ FontSize = 18, FontWeight = Bold, Text = $Title ]

            TextBlock [ Margin = (0,14,0,0), FontSize = 12, FontWeight = Bold, Foreground = @Primary, Text = "Registry" ]
            TextBlock [ Margin = (0,6,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Registry URL" ]
            TextBox [ Text = $Registry ]
            TextBlock [ Margin = (0,6,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Scope" ]
            TextBox [ Text = $Scope ]
            TextBlock [ Margin = (0,6,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Org" ]
            TextBox [ Text = $Org ]
            Button [ Margin = (0,8,0,0), Command = $SaveSettings ] { TextBlock [ Text = "Save connection" ] }

            TextBlock [ Margin = (0,18,0,0), FontSize = 12, FontWeight = Bold, Foreground = @Primary, Text = "Auth token" ]
            TextBlock [ FontSize = 12, Text = $Status ]

            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Stored token" ]
            TextBox [ Text = $TokenInput ]
            StackPanel [ Orientation = Horizontal, Margin = (0,6,0,0) ] {
                Button [ Margin = (0,0,8,0), Command = $SaveToken ] { TextBlock [ Text = "Save token" ] }
                Button [ Command = $ClearToken ] { TextBlock [ Text = "Clear" ] }
            }

            TextBlock [ Margin = (0,12,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "…or use an environment variable" ]
            StackPanel [ Orientation = Horizontal, Margin = (0,6,0,0) ] {
                ComboBox [ Width = 280, ItemsSource = $EnvVars, SelectedItem = $SelectedEnvVar ]
                Button [ Margin = (8,0,0,0), Command = $UseEnv ] { TextBlock [ Text = "Use env var" ] }
            }
        }
    }
}
```

- [ ] **Step 3: Commit** (build at Task 6)
```bash
git add app/src/renderer/pages/setup/setup-vm.ts app/src/renderer/pages/setup/setup.mu
git commit -m "feat(app): SetupVM + setup.mu (connection + stored/env-var token)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `PublishVM` + `publish.mu`

The Publish page: pick a local directory, then publish it to the registry.

**Files:**
- Create: `app/src/renderer/pages/publish/publish-vm.ts`
- Create: `app/src/renderer/pages/publish/publish.mu`

**Interfaces:** Consumes `RegistryClient`. Produces `class PublishVM` (`new PublishVM(client)`) with DPs `Dir`, `Status`, commands `Choose`, `Publish`.

- [ ] **Step 1: Create `app/src/renderer/pages/publish/publish-vm.ts`:**

```ts
import { MuralBase, MetaData, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { RegistryClient } from "../../services/registry-client.js";

/** The Publish page: choose a local project dir and publish it to the registry. */
export class PublishVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(PublishVM, "Title", "Publish", MetaData.None);
  static DirKey = MuralBase.RegisterProperty<string>(PublishVM, "Dir", "", MetaData.None);
  static StatusKey = MuralBase.RegisterProperty<string>(PublishVM, "Status", "", MetaData.None);
  static ChooseKey = MuralBase.RegisterProperty<ICommand | undefined>(PublishVM, "Choose", undefined, MetaData.None);
  static PublishKey = MuralBase.RegisterProperty<ICommand | undefined>(PublishVM, "Publish", undefined, MetaData.None);

  get Title(): string { return this.get_property_value(PublishVM.TitleKey); }
  get Dir(): string { return this.get_property_value(PublishVM.DirKey); }
  get Status(): string { return this.get_property_value(PublishVM.StatusKey); }
  get Choose(): ICommand | undefined { return this.get_property_value(PublishVM.ChooseKey); }
  get Publish(): ICommand | undefined { return this.get_property_value(PublishVM.PublishKey); }

  constructor(private readonly client: RegistryClient) {
    super();
    this.set_property_value(PublishVM.ChooseKey, new RelayCommand(() => void this.choose()));
    this.set_property_value(PublishVM.PublishKey, new RelayCommand(() => void this.publish()));
  }

  private async choose(): Promise<void> {
    const dir = await this.client.pickDirectory();
    if (dir) this.set_property_value(PublishVM.DirKey, dir);
  }

  private async publish(): Promise<void> {
    if (!this.Dir) {
      this.set_property_value(PublishVM.StatusKey, "Choose a directory first.");
      return;
    }
    this.set_property_value(PublishVM.StatusKey, `Publishing ${this.Dir}…`);
    try {
      await this.client.publishDir(this.Dir);
      this.set_property_value(PublishVM.StatusKey, `Published ${this.Dir} ✓`);
    } catch (err) {
      this.set_property_value(PublishVM.StatusKey, `Publish failed: ${(err as Error).message}`);
    }
  }
}
```

- [ ] **Step 2: Create `app/src/renderer/pages/publish/publish.mu`:**

```
import PublishVM from "./publish-vm.ts"

resources Publish {
    DataTemplate [DataType = PublishVM] {
        StackPanel [ Orientation = Vertical, Margin = (16,16,16,16) ] {
            TextBlock [ FontSize = 18, FontWeight = Bold, Text = $Title ]
            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Project directory" ]
            StackPanel [ Orientation = Horizontal, Margin = (0,6,0,0) ] {
                Button [ Margin = (0,0,8,0), Command = $Choose ] { TextBlock [ Text = "Choose folder…" ] }
                TextBlock [ FontSize = 12, Text = $Dir ]
            }
            Button [ Margin = (0,12,0,0), Command = $Publish ] { TextBlock [ Text = "Publish to registry" ] }
            TextBlock [ Margin = (0,10,0,0), FontSize = 12, Text = $Status ]
        }
    }
}
```

- [ ] **Step 3: Commit**
```bash
git add app/src/renderer/pages/publish/publish-vm.ts app/src/renderer/pages/publish/publish.mu
git commit -m "feat(app): PublishVM + publish.mu (pick dir, publish to registry)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Kind badges on the master list + wire Setup/Publish + point Packages at Setup — then build

Populate `PackageItemVM.Kind` (via `getMeta`), add the badge to `packages.mu`, drop the inline token field (point to Setup), and register the two new pages.

**Files:**
- Modify: `app/src/renderer/pages/packages/package-item-vm.ts` (+ `Kind` DP + `setKind`)
- Modify: `app/src/renderer/pages/packages/packages-vm.ts` (fetch kinds; `onConfigure` callback; drop token field)
- Modify: `app/src/renderer/pages/packages/packages.mu` (badge; replace token field with a "Open Setup" button)
- Modify: `app/src/renderer/app-vm.ts` (setup + publish VMs, `ShowSetup`/`ShowPublish`, pass `onConfigure`)
- Modify: `app/src/renderer/shell.mu` (Setup + Publish buttons)
- Modify: `app/src/renderer/main.ts` (register `Setup`, `Publish` dicts)

- [ ] **Step 1: `package-item-vm.ts`** — add a `Kind` DP + setter:

```ts
  static KindKey = MuralBase.RegisterProperty<string>(PackageItemVM, "Kind", "", MetaData.None);
  get Kind(): string { return this.get_property_value(PackageItemVM.KindKey); }
  setKind(kind: string): void { this.set_property_value(PackageItemVM.KindKey, kind); }
```

- [ ] **Step 2: `packages-vm.ts`** — (a) constructor gains `onConfigure`; (b) after building items, fetch each kind in parallel and stamp it; (c) add a `Configure` command; (d) the no-token message stays but the field moves to Setup. Changes:
  - Constructor signature: `constructor(private readonly client: RegistryClient, private readonly onOpen: (name: string) => void, private readonly onConfigure: () => void)`.
  - Add `static ConfigureKey` + getter + set a `RelayCommand(() => this.onConfigure())` in the constructor.
  - Remove `SetToken`/`TokenInput`/`applyToken` (token now lives in Setup).
  - In `load()`, after setting `Items`, add: `void Promise.all(items.map(async (it) => it.setKind(await this.client.getMeta(it.name))));` where `items` is the array you just built (capture it in a local).
  - Keep `SettingsVisibility`/`StatusMessage`; message when no token: `"No token configured — open Setup to add one."`

- [ ] **Step 3: `packages.mu`** — item row shows the kind badge; the settings `Border` becomes a hint + button. Replace the item template's inner with a DockPanel (name left, kind right) and the settings block:

```
    DataTemplate x:key="PackageItemTemplate" [DataType = PackageItemVM] {
        Border [ Fill = @SurfaceVariant, Padding = (12,8,12,8), Margin = (0,0,0,6) ] {
            DockPanel {
                TextBlock [ DockPanel.Dock = Right, FontSize = 10, Foreground = @Primary, Text = $Kind ]
                TextBlock [ FontSize = 13, Text = $Name ]
            }
        }
    }
```

  And the settings affordance in the page template:

```
            Border [ DockPanel.Dock = Top, Visibility = $SettingsVisibility, Margin = (12,0,12,8), Fill = @SurfaceVariant, Padding = (12,10,12,10) ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ FontSize = 12, Text = $StatusMessage ]
                    Button [ Margin = (0,8,0,0), Command = $Configure ] { TextBlock [ Text = "Open Setup" ] }
                }
            }
```

- [ ] **Step 4: `app-vm.ts`** — add imports (`SetupVM`, `PublishVM`), fields (`setup`, `publish`), property keys/getters (`ShowSetupKey`, `ShowPublishKey`), the `packages` construction now passes `() => this.showSetup()`, and the commands. Add:

```ts
  private readonly setup = new SetupVM(this.client);
  private readonly publish = new PublishVM(this.client);
```

  `packages` line becomes: `new PackagesVM(this.client, (name) => this.openPackageSources(name), () => this.showSetup())`.
  Commands (constructor):

```ts
    this.set_property_value(AppVM.ShowSetupKey, new RelayCommand(() => this.showSetup()));
    this.set_property_value(AppVM.ShowPublishKey, new RelayCommand(() => {
      this.set_property_value(AppVM.ActivePageKey, this.publish);
    }));
```

  Add method:

```ts
  showSetup(): void {
    this.set_property_value(AppVM.ActivePageKey, this.setup);
    void this.setup.load();
  }
```

- [ ] **Step 5: `shell.mu`** — add Setup + Publish buttons (give Packages a bottom margin):

```
                    Button [ Command = $ShowPackages, Margin = (0,0,0,4) ]   { TextBlock [ Text = "Packages" ] }
                    Button [ Command = $ShowPublish, Margin = (0,0,0,4) ]     { TextBlock [ Text = "Publish" ] }
                    Button [ Command = $ShowSetup ]                           { TextBlock [ Text = "Setup" ] }
```

- [ ] **Step 6: `main.ts`** — import + register `Setup` and `Publish` dicts (mirror the `Packages` import + add to the loop).

- [ ] **Step 7: Build + launch smoke** — `cd TODL && npm run build && npm --prefix app run build`; `npm --prefix app run test:e2e -- launch` passes.

- [ ] **Step 8: Commit**
```bash
git add app/src/renderer/pages/packages app/src/renderer/pages/setup app/src/renderer/pages/publish app/src/renderer/app-vm.ts app/src/renderer/shell.mu app/src/renderer/main.ts
git commit -m "feat(app): kind badges + wire Setup/Publish pages + Packages links to Setup" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Auto-update wiring (guarded, inert until a release repo)

Mirror Plexus: a `shouldAutoUpdate` guard (unit-tested) + `initAutoUpdate` calling `electron-updater`, wired in main after window creation, plus a `publish` block in electron-builder.yml. Inert on Windows/dev; documented as needing a release repo + CI.

**Files:**
- Modify: `app/package.json` (add `electron-updater` dep)
- Create: `app/src/main/updater.ts`, `app/src/main/tests/updater.test.ts`
- Modify: `app/src/main/index.ts` (call `initAutoUpdate` after `createWindow`)
- Modify: `app/electron-builder.yml` (add `publish`)

**Interfaces:** Produces `class Updater` with `static shouldAutoUpdate(platform: string, env: Record<string,string|undefined>): boolean` + `static init(): void`.

- [ ] **Step 1: Test** — `app/src/main/tests/updater.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Updater } from "../updater.js";

test("auto-update runs only for a packaged Linux AppImage", () => {
  assert.equal(Updater.shouldAutoUpdate("linux", { APPIMAGE: "/x.AppImage" }), true);
  assert.equal(Updater.shouldAutoUpdate("linux", {}), false); // not packaged
  assert.equal(Updater.shouldAutoUpdate("win32", { APPIMAGE: "/x" }), false); // MSI = manual
});
```

- [ ] **Step 2: RED** — `npm --prefix app test` → fails (no `../updater.js`).

- [ ] **Step 3: Add dep** — in `app/package.json` `dependencies`, add `"electron-updater": "^6.3.9"`; `npm --prefix app install`.

- [ ] **Step 4: Implement `app/src/main/updater.ts`:**

```ts
/**
 * Auto-update wiring (mirrors Plexus). Guarded: only a packaged Linux AppImage
 * auto-updates (Windows ships an MSI = manual updates). Inert until a GitHub
 * releases repo + CI publish artifacts (electron-builder.yml `publish`). `init`
 * lazy-requires electron-updater so the guard stays unit-testable without it.
 */
export class Updater {
  static shouldAutoUpdate(platform: string, env: Record<string, string | undefined>): boolean {
    return platform === "linux" && env["APPIMAGE"] !== undefined;
  }

  static init(): void {
    if (!Updater.shouldAutoUpdate(process.platform, process.env)) return;
    // Lazy import: only loaded in the one environment that auto-updates.
    void import("electron-updater").then(({ autoUpdater }) => {
      void autoUpdater.checkForUpdatesAndNotify();
    });
  }
}
```

- [ ] **Step 5: Wire in main** — in `app/src/main/index.ts`, `import { Updater } from "./updater.js";` and call `Updater.init();` at the end of the `whenReady` handler (after `createWindow()`).

- [ ] **Step 6: electron-builder.yml** — add:

```yaml
publish:
  provider: github
  owner: pragmatic-tech-ai
  repo: todl
```

- [ ] **Step 7: GREEN + build** — `npm --prefix app test` passes; `npm --prefix app run build` succeeds (electron-vite externalizes `electron-updater`, shipped in asar).

- [ ] **Step 8: Commit**
```bash
git add app/package.json app/package-lock.json app/src/main/updater.ts app/src/main/tests/updater.test.ts app/src/main/index.ts app/electron-builder.yml
git commit -m "feat(app): guarded electron-updater wiring (inert until release repo)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: E2e — Setup + Publish + kind badge (injected fake) + live-token smoke doc

Extend the injected-fake e2e to cover the new surface, and document the manual live-token procedure.

**Files:**
- Create: `app/tests/smoke/setup-publish.spec.ts`
- Modify: `app/tests/smoke/packages-page.spec.ts` (the fake bridge gains `getMeta`; assert the kind badge; the no-token test now asserts the "Open Setup" button)
- Create: `docs/app-live-token-smoke.md`

- [ ] **Step 1: packages-page.spec.ts** — in the fake `registry`, add `getMeta: () => Promise.resolve("library")`; after selecting the row, the master badge assertion `await expect(window.getByText("library").first()).toBeVisible()` already holds (kind appears in both row + detail — use `.first()`). In the no-token test, replace the affordance-text assertion target if changed; assert the **Open Setup** button is visible: `await expect(window.getByText("Open Setup")).toBeVisible()`.

- [ ] **Step 2: `app/tests/smoke/setup-publish.spec.ts`** — launch, inject a fake `__todlBridge` with `config.get`/`listEnvVars`/`useEnvToken`/`setToken`, `registry.publishDir`, and `dialog.pickDirectory`, then:

```ts
import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

async function launch(): Promise<{ app: ElectronApplication; window: Page }> {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry, `--user-data-dir=${mkdtempSync(join(tmpdir(), "todl-e2e-"))}`], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });
  return { app, window };
}

test("Setup lists env vars and Publish picks a dir then publishes", async () => {
  const { app, window } = await launch();
  await window.evaluate(() => {
    (window as unknown as { __todlBridge: unknown }).__todlBridge = {
      config: {
        get: () => Promise.resolve({ registry: "https://npm.pkg.github.com", scope: "@pragmatic-tech-ai", org: "pragmatic-tech-ai", tokenSource: "stored", tokenEnvVar: "", hasToken: false }),
        setToken: () => Promise.resolve(),
        useEnvToken: () => Promise.resolve(),
        listEnvVars: () => Promise.resolve(["GH_PAT", "PATH"]),
        setSettings: () => Promise.resolve(),
      },
      registry: { publishDir: () => Promise.resolve() },
      dialog: { pickDirectory: () => Promise.resolve("/tmp/my-lib") },
    };
  });

  // Setup: status line + env-var option render.
  await window.getByText("Setup", { exact: true }).click();
  await expect(window.getByText("Token source: stored token — not set ✗")).toBeVisible({ timeout: 10_000 });
  await expect(window.getByText("Use env var")).toBeVisible();

  // Publish: choose folder → path shows → publish reports success.
  await window.getByText("Publish", { exact: true }).click();
  await window.getByText("Choose folder…").click();
  await expect(window.getByText("/tmp/my-lib")).toBeVisible({ timeout: 10_000 });
  await window.getByText("Publish to registry").click();
  await expect(window.getByText("Published /tmp/my-lib ✓")).toBeVisible({ timeout: 10_000 });

  await app.close();
});
```

- [ ] **Step 3: `docs/app-live-token-smoke.md`** — a short manual procedure: build (`npm run build && npm --prefix app run build`), launch the packaged/dev app, open **Setup**, either paste a `write:packages`-less read token or pick an env var (e.g. `GITHUB_TOKEN`), open **Packages**, confirm the real list loads + a detail renders; optionally **Publish** a scratch library dir. Note it needs a real GitHub Packages token and is out of CI.

- [ ] **Step 4: RED→GREEN** — `rm -rf app/out && npm --prefix app run test:e2e -- setup-publish` (RED, no build) → `npm run build && npm --prefix app run build && npm --prefix app run test:e2e` (all specs GREEN). Adjust locators to how Mural surfaces text if needed (do not weaken assertions).

- [ ] **Step 5: Full regression** — `npm --prefix app run test:e2e`, `npm --prefix app test`, `npx tsx --test "src/package-manager/**/*.test.ts"` all green.

- [ ] **Step 6: Commit**
```bash
git add app/tests/smoke/setup-publish.spec.ts app/tests/smoke/packages-page.spec.ts docs/app-live-token-smoke.md
git commit -m "test(app): SP4 e2e (setup + publish + kind badge) + live-token smoke doc" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Coverage:** Setup page (stored token + env-var ComboBox from `listEnvVars` + connection settings) → Tasks 1,3,4,6,8 ✓ · env-var token resolution in main → Task 1 (`effectiveToken`, injected `env`) ✓ · kind badges → Tasks 2,3,6 (cheap `getManifest`) ✓ · Publish-from-UI → Tasks 3,5,6 (`pickDirectory` + `publishDir`) ✓ · auto-update → Task 7 (guarded, documented inert) ✓ · live-token smoke → Task 8 doc ✓.

**2. Placeholders:** none — full code for every new file; edits specify exact insertions. Auto-update being inert is intentional + documented.

**3. Type/name consistency:** `TokenSource` enum in `settings-store.ts` used by `RegistrySettings`, `ConfigView`, bridge. `ConfigView` extended fields flow through `env.d.ts` → `SetupVM`. Channels match preload↔register-ipc: `registry:getMeta`, `config:{setToken,useEnvToken,envVars,setSettings,get}`, `dialog:pickDirectory`. `RegistryClient` methods (`getMeta`, `setStoredToken`, `useEnvToken`, `listEnvVars`, `publishDir`, `pickDirectory`) match `SetupVM`/`PublishVM`/`PackagesVM` call sites. `RegistryLike` gains `getManifest` (bridge `getMeta` uses `this.registry().getManifest`); prod `NpmRegistry.getManifest` satisfies it (Task 2). `PackageItemVM.setKind` (Task 6) fed by `getMeta`. `__todlBridge` injection seam reused for all e2e (SP3). `PackagesVM` constructor gains `onConfigure`; `AppVM` passes `() => this.showSetup()`.
