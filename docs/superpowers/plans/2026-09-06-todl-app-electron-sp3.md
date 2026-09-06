# TODL App Electron — SP3: Packages Explorer Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visible **Packages** page to the Electron TODL app — a master list of registry packages with a detail pane showing metadata, resolved dependency closure, compiled content, and an **Open in Playground** action — plus a token settings affordance for an unauthenticated first run. Built on the SP2 bridge; the renderer never touches the network directly.

**Architecture:** Mirror the existing Gallery page's master-detail shape (`ListBox` + templated detail bound through `.mu`). Three `MuralBase` view-models (`PackagesVM`, `PackageItemVM`, `PackageDetailVM`) drive `packages.mu`; they depend on the SP2 `RegistryClient` (injected, so the e2e can swap in a fake `window.todl`). `Open in Playground` needs the package's raw `src/*.todl` text, which the compiled `model.json` does not carry — so SP2's bridge gains one channel, `registry:getSources`, that reads the tarball's `package/src/**` files. `AppVM` gains a `packages` page + `ShowPackages` command that loads on activation.

**Tech Stack:** Mural runtime/framework (`MuralBase`, `RegisterProperty`, `RelayCommand`, `Visibility`), `.mu` templates (DockPanel/StackPanel/Border/TextBlock/Button/ListBox/TextBox), the SP2 `RegistryClient` + `RegistryBridge`, `TarReader` (core), `tsx --test` (getSources logic only), `@playwright/test` `_electron` (page render + injected-fake round-trip).

**Spec:** `docs/superpowers/specs/2026-09-04-todl-app-electron-package-manager-design.md` (SP3 §6, plus the tar reader/§5 for `getSources`). Builds directly on `docs/superpowers/plans/2026-09-06-todl-app-electron-sp2.md` (all SP2 pieces merged to main).

## Global Constraints

- **Renderer stays on the SP2 seam:** page VMs call the injected `RegistryClient`, never `window.todl` directly and never the network. The client is a constructor argument so the e2e injects a fake.
- **MuralBase VMs are NOT node-unit-testable.** Mural's `@pragmatic-tech-ai/mural/runtime` subpath is not resolvable under `tsx --test` (`ERR_PACKAGE_PATH_NOT_EXPORTED` — it resolves only through the Mural vite plugin). So `PackagesVM`/`PackageItemVM`/`PackageDetailVM` are verified by the Playwright e2e (real Mural render), not `tsx`. Only the new **`getSources`** logic (bridge + client, plain classes) is `tsx`-unit-tested.
- **Page VMs extend `MuralBase`** (not `Observable`), because they are `.mu` DataContexts bound with `$`-expressions and `RegisterProperty` — the genuine dependency-property case the workspace rule carves out. This matches the sibling `GalleryVM`/`PlaygroundVM`.
- **OOP, no free functions** (workspace rule): new behavior is class methods. Module-level `const` for constants is fine.
- **Package-manager symbols imported as `import type` only** outside `app/src/main/index.ts` (unchanged SP2 rule) — the new `getSources` bridge method uses the already-injected seam, adding one injected dep `readFiles`.
- **Names:** `RegistryBridge.list()`/`RegistryClient.list()` return **bare** package names (no scope — `NpmRegistry.listPackages` strips it). `getPackage`/`getContent`/`getSources`/`versions` accept a bare name (the client's configured scope qualifies it). `resolveClosure`'s `rootDeps` must be **scoped** names (the pure resolver keys by the tarball `package.json` `name`, which is scoped) — so `PackageDetailVM` builds `${scope}/${name}` for that one call, taking `scope` from `config.get()`.
- **Tests** live in a `tests/` subfolder next to source. **Commits** on a new branch `feat/app-packages-page` cut from `main`; stage only each task's files; **never `git push`**.

---

### Task 0: Branch

**Files:** none (git only)

- [ ] **Step 1:** Confirm clean tree on `main`: `git -C TODL status -sb`.
- [ ] **Step 2:** `git -C TODL checkout -b feat/app-packages-page`
- [ ] **Step 3: Verify** — `git -C TODL branch --show-current` prints `feat/app-packages-page`.

---

### Task 1: `getSources` — bridge channel + client (raw `src/*.todl` for Open-in-Playground)

The compiled `model.json` a package ships does not contain the authored `.todl` text, so Open-in-Playground needs a new path: fetch the tarball, read every `package/src/**` file, return `{ name, text }[]`. Add a `readFiles` seam (prod: `TarReader.read`) to the bridge, a `getSources` method + `registry:getSources` channel, the preload wrapper, and the client method. This is the only `tsx`-testable slice of SP3.

**Files:**
- Modify: `app/src/main/registry/registry-bridge.ts` (add `readFiles` dep + `getSources`)
- Modify: `app/src/main/registry/tests/registry-bridge.test.ts` (getSources test + `makeBridge` gains `readFiles`)
- Modify: `app/src/main/registry/register-ipc.ts` (register `registry:getSources`)
- Modify: `app/src/preload/index.ts` (add `getSources` wrapper)
- Modify: `app/src/renderer/env.d.ts` (add `getSources` to the typed surface)
- Modify: `app/src/main/index.ts` (inject `readFiles: (bytes) => TarReader.read(bytes)`)
- Modify: `app/src/renderer/services/registry-client.ts` (add `getSources`)
- Modify: `app/src/renderer/services/tests/registry-client.test.ts` (getSources forward test)

**Interfaces:**
- Produces: `interface PackageSource { name: string; text: string }` (exported from `registry-bridge.ts`); `RegistryBridge.getSources(ref: PackageRef): Promise<PackageSource[]>`; `RegistryBridgeDeps.readFiles(bytes: Uint8Array): { path: string; bytes: Uint8Array }[]`; `RegistryClient.getSources(ref: PackageRef): Promise<PackageSource[]>`. Consumed by `AppVM.openPackageSources` (Task 6).

- [ ] **Step 1: Extend the bridge test** — in `app/src/main/registry/tests/registry-bridge.test.ts`, update `makeBridge` to supply `readFiles` and add a test. Change the `makeBridge` factory's `new RegistryBridge({...})` to include a `readFiles` (defaulting to none):

```ts
function makeBridge(
  registry: RegistryLike,
  readPackage = () => undefined as any,
  resolve = () => ({}) as any,
  readFiles: (bytes: Uint8Array) => { path: string; bytes: Uint8Array }[] = () => [],
) {
  const dir = freshDir();
  return new RegistryBridge({
    tokenStore: new TokenStore(dir, new PlainEncryptor()),
    settingsStore: new SettingsStore(dir),
    createRegistry: () => registry,
    readPackage,
    resolveClosure: resolve,
    readFiles,
  });
}
```

Also add `readFiles: () => []` to the inline `new RegistryBridge({...})` in the "setSettings is reflected" test (it constructs the bridge directly). Then add:

```ts
test("getSources returns only package/src files, stripped to their uri", async () => {
  const content = new Map<string, Uint8Array>([["@pragmatic-tech-ai/aws", enc.encode("aws-bytes")]]);
  const files = [
    { path: "package/package.json", bytes: enc.encode("{}") },
    { path: "package/model.json", bytes: enc.encode("{}") },
    { path: "package/src/aws.todl", bytes: enc.encode("concept EC2;\n") },
    { path: "package/src/nested/more.todl", bytes: enc.encode("concept S3;\n") },
  ];
  const bridge = makeBridge(new FakeRegistry([], content), () => undefined as any, () => ({}) as any, () => files);
  const sources = await bridge.getSources({ name: "@pragmatic-tech-ai/aws" });
  assert.deepEqual(sources, [
    { name: "aws.todl", text: "concept EC2;\n" },
    { name: "nested/more.todl", text: "concept S3;\n" },
  ]);
});
```

- [ ] **Step 2: Run RED** — `npm --prefix app test` → the getSources test fails (`bridge.getSources is not a function`); existing bridge tests still pass (they now pass `readFiles`).

- [ ] **Step 3: Implement in `app/src/main/registry/registry-bridge.ts`.** Add the interface near `ConfigView`:

```ts
/** One authored source file recovered from a package tarball (`package/src/**`). */
export interface PackageSource {
  name: string;
  text: string;
}
```

Add to `RegistryBridgeDeps` (after `resolveClosure`):

```ts
  /** Read every file from tarball bytes (prod: `TarReader.read`). */
  readFiles(bytes: Uint8Array): { path: string; bytes: Uint8Array }[];
```

Add the method (after `publishDir`), and a module-level `const SRC_PREFIX = "package/src/";` plus `const decoder = new TextDecoder();` at the top of the file:

```ts
  async getSources(ref: PackageRef): Promise<PackageSource[]> {
    const bytes = await this.registry().getContent(ref);
    return this.deps
      .readFiles(bytes)
      .filter((f) => f.path.startsWith(SRC_PREFIX))
      .map((f) => ({ name: f.path.slice(SRC_PREFIX.length), text: decoder.decode(f.bytes) }));
  }
```

- [ ] **Step 4: Run GREEN (bridge)** — `npm --prefix app test` → all bridge tests pass.

- [ ] **Step 5: Register the channel** — in `app/src/main/registry/register-ipc.ts`, add after the `registry:publishDir` line:

```ts
    ipcMain.handle("registry:getSources", (_e, ref) => bridge.getSources(ref));
```

- [ ] **Step 6: Preload wrapper** — in `app/src/preload/index.ts`, add to the `registry` object (after `publishDir`):

```ts
    getSources: (ref: unknown) => ipcRenderer.invoke("registry:getSources", ref),
```

- [ ] **Step 7: Typed surface** — in `app/src/renderer/env.d.ts`, add `PackageSource` to the type import from the bridge and the method to `registry`:

Change the bridge import to `import type { ConfigView, PackageSource } from "../main/registry/registry-bridge.js";` and add inside `registry: { ... }`:

```ts
    getSources(ref: PackageRef): Promise<PackageSource[]>;
```

- [ ] **Step 8: Inject `readFiles` in main** — in `app/src/main/index.ts`, add to the `new RegistryBridge({...})` deps (after `resolveClosure`):

```ts
    readFiles: (bytes) => TarReader.read(bytes),
```

- [ ] **Step 9: Client method + test** — in `app/src/renderer/services/registry-client.ts`, add `PackageSource` to the bridge type import (`import type { ConfigView } ...` → `import type { ConfigView, PackageSource } from "../../main/registry/registry-bridge.js";`) and add the method (after `getPackage`):

```ts
  getSources(ref: PackageRef): Promise<PackageSource[]> {
    return window.todl.registry.getSources(ref);
  }
```

In `app/src/renderer/services/tests/registry-client.test.ts`, add `getSources: record("getSources")` to the stub's `registry` object, and extend the "forward their arguments" test to also call `await client.getSources({ name: "aws" })` and assert it forwards `[{ name: "aws" }]`.

- [ ] **Step 10: GREEN (client) + build** — `npm --prefix app test` → all pass; then `cd TODL && npm run build && npm --prefix app run build` succeeds and `grep -q "registry:getSources" app/out/preload/index.js && echo PRELOAD_OK`.

- [ ] **Step 11: Commit**
```bash
git add app/src/main/registry/registry-bridge.ts app/src/main/registry/tests/registry-bridge.test.ts app/src/main/registry/register-ipc.ts app/src/preload/index.ts app/src/renderer/env.d.ts app/src/main/index.ts app/src/renderer/services/registry-client.ts app/src/renderer/services/tests/registry-client.test.ts
git commit -m "feat(app): registry:getSources — raw package src for open-in-playground" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `PlaygroundVM.loadSource` — load raw package sources into the editor

Open-in-Playground concatenates the package's `.todl` files (with a header per file) into the single-source Playground editor, mirroring the hashed-source path (which sets `Runner.Source` directly and shows no golden chip).

**Files:** Modify `app/src/renderer/pages/playground/playground-vm.ts`

**Interfaces:** Consumes `PackageSource` (type) from `../../services/registry-client.js` (re-exported there) — actually import the type from `../../main/registry/registry-bridge.js`. Produces `PlaygroundVM.loadSource(sources: PackageSource[]): void`, consumed by `AppVM.openPackageSources` (Task 6).

- [ ] **Step 1: Add the import** at the top of `playground-vm.ts`:

```ts
import type { PackageSource } from "../../main/registry/registry-bridge.js";
```

- [ ] **Step 2: Add the method** after the existing `load(entry)` method:

```ts
  /** Load raw package sources into the editor (Open-in-Playground). Multiple files
   *  are concatenated with a header per file; like a hashed session this has no
   *  owning corpus example, so the golden chip stays collapsed. */
  loadSource(sources: PackageSource[]): void {
    this.loadedEntry = null;
    const text = sources.map((s) => `// === ${s.name} ===\n${s.text}`).join("\n\n");
    this.Runner.Source = text;
    this.refreshGolden(); // collapses the chip (no loadedEntry)
  }
```

- [ ] **Step 3: Verify it compiles** (reachable via existing `main.ts`) — `cd TODL && npm --prefix app run build` succeeds. (No unit test: `PlaygroundVM` imports Mural + the editor, not node-loadable.)

- [ ] **Step 4: Commit**
```bash
git add app/src/renderer/pages/playground/playground-vm.ts
git commit -m "feat(app): PlaygroundVM.loadSource — load raw package sources" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `PackageItemVM` + `PackageDetailVM`

The master row (just the package name) and the detail view-model that populates the four facets on `load`. Facet data is exposed as preformatted strings so `packages.mu` stays simple TextBlocks.

**Files:**
- Create: `app/src/renderer/pages/packages/package-item-vm.ts`
- Create: `app/src/renderer/pages/packages/package-detail-vm.ts`

**Interfaces:**
- Consumes: `RegistryClient` (Task/SP2); `type VersionList`, `type InstalledPackage`, `type ResolvedClosure` (type-only) from `@pragmatic-tech-ai/todl/package-manager`.
- Produces: `class PackageItemVM` with `readonly name: string` + `Name` DP. `class PackageDetailVM` constructed as `new PackageDetailVM(client: RegistryClient, scope: string, onOpen: (name: string) => void)` with DPs `Title`, `Kind`, `Version`, `DistTags`, `Dependencies`, `Closure`, `Content`, command `Open`, and `load(name: string): Promise<void>`. Consumed by `PackagesVM` (Task 4).

- [ ] **Step 1: Create `app/src/renderer/pages/packages/package-item-vm.ts`:**

```ts
import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";

/** One master-list row: the bare package name (kind lives in the detail pane,
 *  since it requires fetching the package). */
export class PackageItemVM extends MuralBase {
  static NameKey = MuralBase.RegisterProperty<string>(PackageItemVM, "Name", "", MetaData.None);

  get Name(): string {
    return this.get_property_value(PackageItemVM.NameKey);
  }

  readonly name: string;

  constructor(name: string) {
    super();
    this.name = name;
    this.set_property_value(PackageItemVM.NameKey, name);
  }
}
```

- [ ] **Step 2: Create `app/src/renderer/pages/packages/package-detail-vm.ts`:**

```ts
import { MuralBase, MetaData, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { RegistryClient } from "../../services/registry-client.js";
import type { VersionList, InstalledPackage, ResolvedClosure } from "@pragmatic-tech-ai/todl/package-manager";

/** The detail pane for one package: metadata, resolved closure, compiled content,
 *  and Open-in-Playground. Facets are preformatted strings, filled by `load`. */
export class PackageDetailVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(PackageDetailVM, "Title", "", MetaData.None);
  static KindKey = MuralBase.RegisterProperty<string>(PackageDetailVM, "Kind", "", MetaData.None);
  static VersionKey = MuralBase.RegisterProperty<string>(PackageDetailVM, "Version", "", MetaData.None);
  static DistTagsKey = MuralBase.RegisterProperty<string>(PackageDetailVM, "DistTags", "", MetaData.None);
  static DependenciesKey = MuralBase.RegisterProperty<string>(PackageDetailVM, "Dependencies", "", MetaData.None);
  static ClosureKey = MuralBase.RegisterProperty<string>(PackageDetailVM, "Closure", "", MetaData.None);
  static ContentKey = MuralBase.RegisterProperty<string>(PackageDetailVM, "Content", "", MetaData.None);
  static OpenKey = MuralBase.RegisterProperty<ICommand | undefined>(PackageDetailVM, "Open", undefined, MetaData.None);

  get Title(): string { return this.get_property_value(PackageDetailVM.TitleKey); }
  get Kind(): string { return this.get_property_value(PackageDetailVM.KindKey); }
  get Version(): string { return this.get_property_value(PackageDetailVM.VersionKey); }
  get DistTags(): string { return this.get_property_value(PackageDetailVM.DistTagsKey); }
  get Dependencies(): string { return this.get_property_value(PackageDetailVM.DependenciesKey); }
  get Closure(): string { return this.get_property_value(PackageDetailVM.ClosureKey); }
  get Content(): string { return this.get_property_value(PackageDetailVM.ContentKey); }
  get Open(): ICommand | undefined { return this.get_property_value(PackageDetailVM.OpenKey); }

  constructor(
    private readonly client: RegistryClient,
    private readonly scope: string,
    private readonly onOpen: (name: string) => void,
  ) {
    super();
    this.set_property_value(PackageDetailVM.OpenKey, new RelayCommand(() => this.onOpen(this.currentName)));
  }

  private currentName = "";

  async load(name: string): Promise<void> {
    this.currentName = name;
    this.set_property_value(PackageDetailVM.TitleKey, name);
    const scoped = `${this.scope}/${name}`;

    const versions: VersionList = await this.client.versions(name);
    const latest = versions.distTags["latest"] ?? versions.versions[versions.versions.length - 1] ?? "—";
    this.set_property_value(PackageDetailVM.VersionKey, latest);
    this.set_property_value(
      PackageDetailVM.DistTagsKey,
      Object.entries(versions.distTags).map(([tag, v]) => `${tag} → ${v}`).join(", ") || "—",
    );

    const pkg: InstalledPackage = await this.client.getPackage({ name });
    this.set_property_value(PackageDetailVM.KindKey, pkg.meta.kind);
    this.set_property_value(
      PackageDetailVM.DependenciesKey,
      pkg.dependencies.length > 0 ? pkg.dependencies.join(", ") : "none",
    );
    const nodes = pkg.document.nodes?.length ?? 0;
    const edges = pkg.document.edges?.length ?? 0;
    this.set_property_value(PackageDetailVM.ContentKey, `${nodes} nodes · ${edges} edges`);

    const closure: ResolvedClosure = await this.client.resolveClosure([scoped]);
    this.set_property_value(PackageDetailVM.ClosureKey, closure.order.join("  →  "));
  }
}
```

- [ ] **Step 3: Verify** — no build yet (not reachable until Task 6). Confirm the files are syntactically consistent by eye; the Task 6 build compiles them. Commit.

- [ ] **Step 4: Commit**
```bash
git add app/src/renderer/pages/packages/package-item-vm.ts app/src/renderer/pages/packages/package-detail-vm.ts
git commit -m "feat(app): PackageItemVM + PackageDetailVM (four detail facets)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `PackagesVM` — master list, selection→detail, token settings

The page VM: loads the package list + token state on `load()`, builds a `PackageDetailVM` on selection, and exposes a token field + command for an unauthenticated first run.

**Files:** Create `app/src/renderer/pages/packages/packages-vm.ts`

**Interfaces:**
- Consumes: `RegistryClient`, `PackageItemVM` (Task 3), `PackageDetailVM` (Task 3).
- Produces: `class PackagesVM` constructed as `new PackagesVM(client: RegistryClient, onOpen: (name: string) => void)` with DPs `Title`, `Items`, `Selected`, `Detail`, `TokenInput`, `SettingsVisibility`, `StatusMessage`, command `SetToken`, and `load(): Promise<void>`. Consumed by `AppVM` (Task 6).

- [ ] **Step 1: Create `app/src/renderer/pages/packages/packages-vm.ts`:**

```ts
import { MuralBase, MetaData, RelayCommand, Visibility, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { RegistryClient } from "../../services/registry-client.js";
import { PackageItemVM } from "./package-item-vm.js";
import { PackageDetailVM } from "./package-detail-vm.js";

/** The Packages page: master list of registry package names + a detail pane, with
 *  a token settings affordance shown until the main process reports a token. */
export class PackagesVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(PackagesVM, "Title", "Packages", MetaData.None);
  static ItemsKey = MuralBase.RegisterProperty<PackageItemVM[]>(PackagesVM, "Items", [], MetaData.None);
  static SelectedKey = MuralBase.RegisterProperty<PackageItemVM | undefined>(PackagesVM, "Selected", undefined, MetaData.None);
  static DetailKey = MuralBase.RegisterProperty<PackageDetailVM | undefined>(PackagesVM, "Detail", undefined, MetaData.None);
  static TokenInputKey = MuralBase.RegisterProperty<string>(PackagesVM, "TokenInput", "", MetaData.None);
  static SettingsVisibilityKey = MuralBase.RegisterProperty<Visibility>(PackagesVM, "SettingsVisibility", Visibility.Collapsed, MetaData.None);
  static StatusMessageKey = MuralBase.RegisterProperty<string>(PackagesVM, "StatusMessage", "", MetaData.None);
  static SetTokenKey = MuralBase.RegisterProperty<ICommand | undefined>(PackagesVM, "SetToken", undefined, MetaData.None);

  get Title(): string { return this.get_property_value(PackagesVM.TitleKey); }
  get Items(): PackageItemVM[] { return this.get_property_value(PackagesVM.ItemsKey); }
  get TokenInput(): string { return this.get_property_value(PackagesVM.TokenInputKey); }
  get SettingsVisibility(): Visibility { return this.get_property_value(PackagesVM.SettingsVisibilityKey); }
  get StatusMessage(): string { return this.get_property_value(PackagesVM.StatusMessageKey); }
  get SetToken(): ICommand | undefined { return this.get_property_value(PackagesVM.SetTokenKey); }

  private scope = "@pragmatic-tech-ai";

  constructor(
    private readonly client: RegistryClient,
    private readonly onOpen: (name: string) => void,
  ) {
    super();
    this.set_property_value(PackagesVM.SetTokenKey, new RelayCommand(() => void this.applyToken()));
    // Selecting a row builds + loads its detail pane.
    this.AddPropertyChangedListener(PackagesVM.SelectedKey, () => {
      const sel = this.get_property_value(PackagesVM.SelectedKey);
      if (!sel) return;
      const detail = new PackageDetailVM(this.client, this.scope, this.onOpen);
      this.set_property_value(PackagesVM.DetailKey, detail);
      void detail.load(sel.name);
    });
  }

  /** (Re)load token state + the package list. Called when the page is shown. */
  async load(): Promise<void> {
    const config = await this.client.getConfig();
    this.scope = config.scope;
    this.set_property_value(PackagesVM.SettingsVisibilityKey, config.hasToken ? Visibility.Collapsed : Visibility.Visible);
    if (!config.hasToken) {
      this.set_property_value(PackagesVM.StatusMessageKey, "Set a GitHub Packages token to browse packages.");
      this.set_property_value(PackagesVM.ItemsKey, []);
      return;
    }
    try {
      const names = await this.client.list();
      this.set_property_value(PackagesVM.ItemsKey, names.map((n) => new PackageItemVM(n)));
      this.set_property_value(PackagesVM.StatusMessageKey, names.length === 0 ? "No packages found." : "");
    } catch (err) {
      this.set_property_value(PackagesVM.StatusMessageKey, `Failed to list packages: ${(err as Error).message}`);
    }
  }

  private async applyToken(): Promise<void> {
    await this.client.setToken(this.TokenInput);
    this.set_property_value(PackagesVM.TokenInputKey, "");
    await this.load();
  }
}
```

- [ ] **Step 2: Commit** (build happens at Task 6)
```bash
git add app/src/renderer/pages/packages/packages-vm.ts
git commit -m "feat(app): PackagesVM — master list, selection, token settings" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `packages.mu` — master-detail templates

Mirror `gallery.mu`: an item template (name row), a detail template (labeled facets + Open button), and the page template (title, token field gated by `SettingsVisibility`, master `ListBox`, detail `ContentControl`).

**Files:** Create `app/src/renderer/pages/packages/packages.mu`

**Interfaces:** Consumes `PackagesVM`, `PackageItemVM`, `PackageDetailVM`. Produces a `Packages` resource dictionary (registered in `main.ts`, Task 6).

- [ ] **Step 1: Create `app/src/renderer/pages/packages/packages.mu`:**

```
import PackagesVM from "./packages-vm.ts"
import PackageItemVM from "./package-item-vm.ts"
import PackageDetailVM from "./package-detail-vm.ts"

resources Packages {
    DataTemplate x:key="PackageItemTemplate" [DataType = PackageItemVM] {
        Border [ Fill = @SurfaceVariant, Padding = (12,8,12,8), Margin = (0,0,0,6) ] {
            TextBlock [ FontSize = 13, Text = $Name ]
        }
    }
    DataTemplate x:key="PackageDetailTemplate" [DataType = PackageDetailVM] {
        StackPanel [ Orientation = Vertical, Margin = (16,16,16,16) ] {
            TextBlock [ FontSize = 18, FontWeight = Bold, Text = $Title ]
            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Kind" ]
            TextBlock [ FontSize = 13, Text = $Kind ]
            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Version" ]
            TextBlock [ FontSize = 13, Text = $Version ]
            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Dist-tags" ]
            TextBlock [ FontSize = 13, Text = $DistTags ]
            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Dependencies" ]
            TextBlock [ FontSize = 13, Text = $Dependencies ]
            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Resolved closure" ]
            TextBlock [ FontSize = 13, Text = $Closure ]
            TextBlock [ Margin = (0,10,0,0), FontSize = 11, Foreground = @OnSurfaceVariant, Text = "Compiled content" ]
            TextBlock [ FontSize = 13, Text = $Content ]
            Button [ Margin = (0,16,0,0), Command = $Open ] { TextBlock [ Text = "Open in Playground" ] }
        }
    }
    DataTemplate [DataType = PackagesVM] {
        DockPanel {
            TextBlock [ DockPanel.Dock = Top, Margin = (12,12,12,8), FontSize = 18, FontWeight = Bold, Text = $Title ]
            Border [ DockPanel.Dock = Top, Visibility = $SettingsVisibility, Margin = (12,0,12,8), Fill = @SurfaceVariant, Padding = (12,10,12,10) ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ FontSize = 12, Text = $StatusMessage ]
                    TextBox [ Margin = (0,8,0,8), Text = $TokenInput ]
                    Button [ Command = $SetToken ] { TextBlock [ Text = "Save token" ] }
                }
            }
            Border [ DockPanel.Dock = Left, Width = 260 ] {
                ListBox [ Margin = (12,0,12,12), ItemsSource = $Items, ItemTemplate = @PackageItemTemplate, SelectedItem = $Selected ]
            }
            ContentControl [ Content = $Detail ]
        }
    }
}
```

- [ ] **Step 2: Commit** (build at Task 6)
```bash
git add app/src/renderer/pages/packages/packages.mu
git commit -m "feat(app): packages.mu — master-detail templates + token field" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire the page into `AppVM`, `shell.mu`, `main.ts` — then build

Register the page: `AppVM` gains a `client`, the `packages` VM, an `openPackageSources` action, and a `ShowPackages` command that activates + loads the page; `shell.mu` gains the sidebar button; `main.ts` registers the `Packages` dictionary. This is the first task whose build exercises Tasks 2–5.

**Files:**
- Modify: `app/src/renderer/app-vm.ts`
- Modify: `app/src/renderer/shell.mu`
- Modify: `app/src/renderer/main.ts`

**Interfaces:** Consumes `PackagesVM` (Task 4), `RegistryClient` (SP2), `PlaygroundVM.loadSource` (Task 2), the `Packages` dict (Task 5). Produces `AppVM.ShowPackages` (command) bound in `shell.mu`.

- [ ] **Step 1: `app/src/renderer/app-vm.ts`** — add imports:

```ts
import { PackagesVM } from "./pages/packages/packages-vm.js";
import { RegistryClient } from "./services/registry-client.js";
```

Add the property key + getter (next to the others):

```ts
  static ShowPackagesKey = MuralBase.RegisterProperty<ICommand | undefined>(AppVM, "ShowPackages", undefined, MetaData.None);
  get ShowPackages(): ICommand | undefined { return this.get_property_value(AppVM.ShowPackagesKey); }
```

Add the fields (after `docs`):

```ts
  private readonly client = new RegistryClient();
  private readonly packages = new PackagesVM(this.client, (name) => this.openPackageSources(name));
```

Register the command in the constructor (after `ShowDocsKey`):

```ts
    this.set_property_value(AppVM.ShowPackagesKey, new RelayCommand(() => {
      this.set_property_value(AppVM.ActivePageKey, this.packages);
      void this.packages.load();
    }));
```

Add the action method (after `openInPlayground`):

```ts
  openPackageSources(name: string): void {
    void this.client.getSources({ name }).then((sources) => {
      this.playground.loadSource(sources);
      this.set_property_value(AppVM.ActivePageKey, this.playground);
    });
  }
```

- [ ] **Step 2: `app/src/renderer/shell.mu`** — add a Packages button after the Docs button:

```
                    Button [ Command = $ShowDocs, Margin = (0,0,0,4) ]      { TextBlock [ Text = "Docs" ] }
                    Button [ Command = $ShowPackages ]                      { TextBlock [ Text = "Packages" ] }
```

(Change the existing Docs button line to add `Margin = (0,0,0,4)` so the new last button has none — matching the existing spacing pattern.)

- [ ] **Step 3: `app/src/renderer/main.ts`** — import + register the dict. Add after the `Docs` import:

```ts
// @ts-expect-error compiled by vitePluginMural
import { Packages } from "./pages/packages/packages.mu";
```

And add `Packages` to the dictionaries loop:

```ts
for (const dict of [AppShell, ExampleRunner, Playground, Gallery, Docs, Packages]) {
```

- [ ] **Step 4: Build** — `cd TODL && npm run build && npm --prefix app run build`. Expected: success. If the Mural compiler rejects a `.mu` element (e.g. `TextBox` binding or `Visibility` on `Border`), fix per the error (fallbacks: a two-way `TextBox.Text` may need explicit mode — check `gallery.mu`/Plexus usage; `Visibility` binding is used by `PlaygroundVM.GoldenVisibility`, so it is supported on elements). Report BLOCKED only if a required primitive genuinely does not exist.

- [ ] **Step 5: Launch smoke sanity** — `npm --prefix app run test:e2e -- launch` still passes (the existing app boots with the new page registered). 

- [ ] **Step 6: Commit**
```bash
git add app/src/renderer/app-vm.ts app/src/renderer/shell.mu app/src/renderer/main.ts
git commit -m "feat(app): wire Packages page into AppVM + shell + main" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: E2e — injected-fake round-trip + no-token state

Two deterministic Playwright `_electron` checks, no network. (1) A clean profile → the token settings affordance is visible and the list is empty. (2) Inject a fake `window.todl` after boot, click **Packages**, and assert the master list renders, selecting a row fills the detail facets, and **Open in Playground** round-trips the sources into the editor.

**Files:** Create `app/tests/smoke/packages-page.spec.ts`

- [ ] **Step 1: Write the test** — `app/tests/smoke/packages-page.spec.ts`:

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
  const userDataDir = mkdtempSync(join(tmpdir(), "todl-e2e-"));
  const app = await electron.launch({ args: [mainEntry, `--user-data-dir=${userDataDir}`], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });
  return { app, window };
}

async function clickPackages(window: Page): Promise<void> {
  await window.getByText("Packages", { exact: true }).click();
}

test("no token: the Packages page shows the settings affordance", async () => {
  const { app, window } = await launch();
  await clickPackages(window);
  await expect(window.getByText("Set a GitHub Packages token to browse packages.")).toBeVisible({ timeout: 10_000 });
  await app.close();
});

test("with a fake registry: list -> select -> detail facets -> open in playground", async () => {
  const { app, window } = await launch();

  // Replace the SP2 bridge with an in-page fake BEFORE showing the page (PackagesVM
  // loads on activation). Exercises the real Mural VMs + templates, no network.
  await window.evaluate(() => {
    const model = { nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }] };
    (window as unknown as { todl: unknown }).todl = {
      config: {
        get: () => Promise.resolve({ registry: "r", scope: "@pragmatic-tech-ai", org: "o", hasToken: true }),
        setToken: () => Promise.resolve(),
        setSettings: () => Promise.resolve(),
      },
      registry: {
        list: () => Promise.resolve(["aws"]),
        versions: () => Promise.resolve({ versions: ["0.1.0"], distTags: { latest: "0.1.0" } }),
        getPackage: () => Promise.resolve({ name: "@pragmatic-tech-ai/aws", meta: { kind: "library", id: "aws" }, dependencies: ["@pragmatic-tech-ai/tech-architecture"], document: model }),
        resolveClosure: () => Promise.resolve({ metaModels: [], libraries: [model], order: ["@pragmatic-tech-ai/tech-architecture", "@pragmatic-tech-ai/aws"] }),
        getContent: () => Promise.resolve(new Uint8Array()),
        getSources: () => Promise.resolve([{ name: "aws.todl", text: "concept EC2;\n" }]),
        publishDir: () => Promise.resolve(),
      },
    };
  });

  await clickPackages(window);

  // Master list renders the fake package.
  const row = window.getByText("aws", { exact: true });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();

  // Detail facets populate.
  await expect(window.getByText("library", { exact: true })).toBeVisible();
  await expect(window.getByText("2 nodes · 1 edges")).toBeVisible();
  await expect(window.getByText("@pragmatic-tech-ai/tech-architecture  →  @pragmatic-tech-ai/aws")).toBeVisible();

  // Open in Playground round-trips the fake source into the editor.
  await window.getByText("Open in Playground").click();
  await expect(window.locator(".monaco-editor")).toBeVisible({ timeout: 10_000 });
  const editorText = await window.locator(".monaco-editor").innerText();
  expect(editorText).toContain("concept EC2;");

  await app.close();
});
```

- [ ] **Step 2: RED** — `rm -rf app/out && npm --prefix app run test:e2e -- packages-page` → FAIL (no `out/main`). Capture as RED.

- [ ] **Step 3: GREEN** — `cd TODL && npm run build && npm --prefix app run build && npm --prefix app run test:e2e -- packages-page` → both tests PASS. If a selector misses because Mural renders text in nested spans, adjust the locator to match how `gallery.mu` rows surface text (use `getByText` substring or a `locator` on the SVG text) — but do not weaken a facet assertion to force green. If `Open in Playground` text can't be found because the detail didn't populate, debug the VM/template binding; report BLOCKED if genuinely stuck.

- [ ] **Step 4: Full regression** — `npm --prefix app run test:e2e` (all specs) + `npm --prefix app test` + `npx tsx --test "src/package-manager/**/*.test.ts"` all green.

- [ ] **Step 5: Commit**
```bash
git add app/tests/smoke/packages-page.spec.ts
git commit -m "test(app): SP3 Packages page e2e (no-token + injected-fake round-trip)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage (SP3 §6):**
- New page mirroring Gallery's master-detail → Tasks 3–6 ✓
- `packages-vm.ts` / `package-item-vm.ts` / `package-detail-vm.ts` / `packages.mu` → Tasks 3–5 (exact filenames from §6) ✓
- Master: `list()` → rows; Settings affordance when `hasToken` false → Task 4 (`SettingsVisibility`, `SetToken`) ✓
- Detail: Metadata (kind, version, dist-tags, deps) → Task 3; Resolved closure (deps-first `order`) → Task 3; Compiled content (node/edge counts) → Task 3; Open in Playground (loads src) → Tasks 1+2+3+6 ✓
- Wiring: `AppVM.packages` + `ShowPackages`, `shell.mu` button, `main.ts` dict → Task 6 ✓
- Done-when: selecting a live package shows all four facets + Open round-trips sources → Task 7 (against an injected fake; live is manual per §8) ✓

**2. Placeholder scan:** every file/edit is fully specified. The design's `getSources` (implied by "load the package's src/ from the read tarball") is made explicit in Task 1. No TBD/TODO.

**3. Type/name consistency:** `getSources`/`PackageSource` defined in `registry-bridge.ts` (Task 1), threaded through preload/env.d.ts/client/main and consumed by `PlaygroundVM.loadSource` (Task 2) + `AppVM.openPackageSources` (Task 6). `RegistryClient` methods used by the VMs (`getConfig`, `list`, `versions`, `getPackage`, `resolveClosure`, `getSources`, `setToken`) all exist post-Task-1. `PackagesVM(client, onOpen)` and `PackageDetailVM(client, scope, onOpen)` constructor shapes match their `AppVM`/`PackagesVM` call sites. `resolveClosure` receives a **scoped** rootDep (`${scope}/${name}`) built from `config.scope` — consistent with the pure resolver keying by scoped `pkg.name` (Global Constraints). `SettingsVisibility`/`Visibility` mirrors `PlaygroundVM.GoldenVisibility`'s proven pattern. `.mu` `$`-bindings (`$Name`, `$Kind`, `$Version`, `$DistTags`, `$Dependencies`, `$Closure`, `$Content`, `$Open`, `$Title`, `$Items`, `$Selected`, `$Detail`, `$TokenInput`, `$SettingsVisibility`, `$StatusMessage`, `$SetToken`, `$ShowPackages`) each map to a declared DP/getter.
