# TODL App — Plexus Composition Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose `TODL/app`'s renderer on the Plexus architecture — a declarative `app.mu` root, Mural's service provider, feature modules, `EditorShell` + `NavigationService` + `DocumentsContentHostService` — deleting the hand-rolled `AppVM` and `shell.mu`.

**Architecture:** `app.mu` is the composition root (`.services:` + `.modules:` + `resources:` with `EditorShell x:root`). Each todl page becomes a module: Playground = a document; Gallery/Packages/Docs = capabilities with side-pane masters that open documents; Setup = a settings-gear contribution; Publish = a rail footer action. Services extend `ServiceBase` and resolve peers via `this.Provider.getRequired(Key)`.

**Tech Stack:** TypeScript + mural 0.46.8 (`@pragmatic-tech-ai/mural` at `file:../../Mural`), `.mu` compiled by the vite mural plugin, electron-vite build, Playwright `_electron` e2e, `tsx --test` unit.

**Spec:** `docs/superpowers/specs/2026-09-06-todl-app-plexus-composition-design.md`

## Global Constraints

- **OOP, no free functions/module-level state.** Behavior lives on classes as methods (static where stateless). Bootstrap `main.ts` is the one plain-imperative entry (mural convention: bootstraps stay thin), matching Plexus `main.js`.
- **View models extend `Observable`, services extend `ServiceBase`, documents implement `IDocument` (a `MuralBase`).** Reserve `MuralBase` for DP-backed view/document types.
- **Enums over string literals.** Reuse framework enums (`SettingKind`, `Visibility`); no string-literal unions.
- **Service token convention:** each service exposes `static readonly Key = new ServiceKey<T>('T')`; register in `.services:` by class; capabilities reference the class as `ServiceKey`; peers resolve via `this.Provider.getRequired(T.Key)`.
- **Content host token:** resolve the document host as `this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService`.
- **Tests in `tests/` subfolders.** MuralBase/ServiceBase types are NOT node-testable (mural `./runtime` unresolvable under `tsx`) — unit-test plain logic only; verify composition via Playwright `_electron` e2e.
- **Do not change** the main process, the preload bridge, or `RegistryClient`'s wire surface (only its file location + base class).
- **Commit messages** end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Never `--no-verify`.
- Run app commands from `TODL/app`. Build gate: `npx electron-vite build`. e2e: `npx playwright test`.

## File Structure

```
renderer/
  app.mu                                      # NEW composition root → export const app
  main.ts                                     # REWRITTEN thin bootstrap
  services/registry/registry-client.ts        # MOVED from services/registry-client.ts; now ServiceBase
  services/registry/tests/registry-client.test.ts   # MOVED
  modules/
    playground/ playground.module.mu · playground.resources.mu · playground-document.ts
    gallery/    gallery.module.mu · gallery.resources.mu · services/gallery-service.ts
    packages/   packages.module.mu · packages.resources.mu · services/packages-service.ts · package-document.ts
    docs/       docs.module.mu · docs.resources.mu · services/docs-service.ts · docs-document.ts
    publish/    publish.module.mu · publish.resources.mu · services/publish-service.ts
    setup/      setup.module.mu · setup.resources.mu · services/setup-contribution.ts
  (deleted) app-vm.ts, shell.mu
  (moved into modules) pages/*  → modules/*  (VMs kept, re-parented)
```

Existing `editor/` and `components/example-runner/` are unchanged; `PlaygroundDocument` wraps them. Each page's existing `*-vm.ts` + sub-VMs move under its module and keep their logic; only base classes / wiring change as specified.

---

### Task 1: `RegistryClient` becomes a root service

**Files:**
- Move: `renderer/services/registry-client.ts` → `renderer/services/registry/registry-client.ts`
- Move: `renderer/services/tests/registry-client.test.ts` → `renderer/services/registry/tests/registry-client.test.ts`

**Interfaces:**
- Produces: `class RegistryClient extends ServiceBase { static readonly Key: ServiceKey<RegistryClient>; constructor(provider) }` — all existing methods (`list`, `versions`, `getContent`, `getPackage`, `getSources`, `getMeta`, `publishDir`, `resolveClosure`, `getConfig`, `setStoredToken`, `useEnvToken`, `listEnvVars`, `setSettings`, `pickDirectory`) unchanged.

- [ ] **Step 1: Move the files (git mv), fixing the test's import depth**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
mkdir -p src/renderer/services/registry/tests
git mv src/renderer/services/registry-client.ts src/renderer/services/registry/registry-client.ts
git mv src/renderer/services/tests/registry-client.test.ts src/renderer/services/registry/tests/registry-client.test.ts
```

- [ ] **Step 2: Make `RegistryClient` a `ServiceBase`**

Edit `src/renderer/services/registry/registry-client.ts`:
- Add to the runtime import: `ServiceBase, ServiceKey, type IServiceProvider`.
- Change the class head and add the key + ctor; keep every method body verbatim (the `bridge()` helper is unchanged — it still reads `window.__todlBridge ?? window.todl`):

```ts
import { ServiceBase, ServiceKey, type IServiceProvider } from "@pragmatic-tech-ai/mural/runtime";
// ...existing type imports (PackageRef, VersionList, InstalledPackage, ResolvedClosure, ConfigView, PackageSource, TodlBridge)...

export class RegistryClient extends ServiceBase {
  static readonly Key = new ServiceKey<RegistryClient>("RegistryClient");
  constructor(provider: IServiceProvider) { super(provider); }

  private bridge(): TodlBridge {
    return (window as unknown as { __todlBridge?: TodlBridge }).__todlBridge ?? window.todl;
  }
  // ...all existing methods unchanged...
}
```
Fix the two relative type imports for the deeper path: `../../main/registry/registry-bridge.js` → `../../../main/registry/registry-bridge.js`, and `../env.js` → `../../env.js`.

- [ ] **Step 3: Fix the test's imports + construction**

Edit `src/renderer/services/registry/tests/registry-client.test.ts`: the import of `RegistryClient` stays `../registry-client.js` (co-located). The test constructs `new RegistryClient()` today — it now needs a provider. Since the test only exercises the `bridge()` pass-throughs against a fake `window.__todlBridge`, pass a stub provider:

```ts
const provider = { get: () => undefined, getRequired: () => { throw new Error("no"); }, has: () => false } as unknown as IServiceProvider;
const client = new RegistryClient(provider);
```
Add `import type { IServiceProvider } from "@pragmatic-tech-ai/mural/runtime";`.

- [ ] **Step 4: Run the unit test**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL/app && npx tsx --test src/renderer/services/registry/tests/registry-client.test.ts`
Expected: PASS (same assertions as before; only construction changed).

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
git add -A src/renderer/services/registry/
git commit -m "refactor(app): RegistryClient becomes a ServiceBase under services/registry/

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `PlaygroundDocument` + PlaygroundModule

**Files:**
- Move: `renderer/pages/playground/*` → `renderer/modules/playground/` (playground-vm.ts, example-ref-vm.ts, permalink-sync.ts, playground.mu)
- Create: `renderer/modules/playground/playground-document.ts`
- Create: `renderer/modules/playground/playground.module.mu`
- Create/rename: `renderer/modules/playground/playground.resources.mu` (was `playground.mu`)

**Interfaces:**
- Consumes: `PlaygroundVM` (unchanged), `CorpusEntry`, `PackageSource`.
- Produces:
  ```ts
  class PlaygroundDocument extends MuralBase implements IDocument {
    static blank(): PlaygroundDocument;
    static forExample(entry: CorpusEntry): PlaygroundDocument;
    static forSources(sources: PackageSource[]): PlaygroundDocument;
    readonly Id: string; readonly Title: string; readonly IsDirty: boolean;
    readonly VM: PlaygroundVM;   // bound by DataTemplate[PlaygroundDocument]
    Save(): void;
  }
  module PlaygroundModule { }   // no services yet; carries the document template
  ```

- [ ] **Step 1: Move the playground page into the module**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
mkdir -p src/renderer/modules/playground
git mv src/renderer/pages/playground/playground-vm.ts   src/renderer/modules/playground/playground-vm.ts
git mv src/renderer/pages/playground/example-ref-vm.ts   src/renderer/modules/playground/example-ref-vm.ts
git mv src/renderer/pages/playground/permalink-sync.ts   src/renderer/modules/playground/permalink-sync.ts
git mv src/renderer/pages/playground/playground.mu        src/renderer/modules/playground/playground.resources.mu
```
Fix relative imports in the moved files that reference `../../` component/main paths (depth is unchanged: `pages/playground/` and `modules/playground/` are both two deep, so imports like `../../components/...` and `../../main/...` stay valid). Verify with a grep; adjust only if a path breaks.

- [ ] **Step 2: Write `PlaygroundDocument` (IDocument wrapping PlaygroundVM)**

Create `src/renderer/modules/playground/playground-document.ts`:

```ts
import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";
import type { IDocument } from "@pragmatic-tech-ai/mural/framework";
import type { CorpusEntry } from "@shared/corpus-types.js";
import type { PackageSource } from "../../main/registry/registry-bridge.js";
import { PlaygroundVM } from "./playground-vm.js";

let seq = 0;

/** A playground editor session as an IDocument, so it shows as a Content tab.
 *  It owns a PlaygroundVM; DataTemplate[PlaygroundDocument] binds $VM. Read-only
 *  w.r.t. the shell's dirty/save model (the editor is a scratch surface), so it
 *  never gates close/quit. */
export class PlaygroundDocument extends MuralBase implements IDocument {
  static readonly IdKey = MuralBase.RegisterProperty<string>(PlaygroundDocument, "Id", "", MetaData.None);
  static readonly TitleKey = MuralBase.RegisterProperty<string>(PlaygroundDocument, "Title", "Playground", MetaData.None);
  static readonly VMKey = MuralBase.RegisterProperty<PlaygroundVM>(PlaygroundDocument, "VM", undefined as unknown as PlaygroundVM, MetaData.None);

  get Id(): string { return this.get_property_value(PlaygroundDocument.IdKey); }
  get Title(): string { return this.get_property_value(PlaygroundDocument.TitleKey); }
  get VM(): PlaygroundVM { return this.get_property_value(PlaygroundDocument.VMKey); }
  get IsDirty(): boolean { return false; }
  Save(): void { /* scratch surface — nothing to persist */ }

  private constructor(id: string, title: string, vm: PlaygroundVM) {
    super();
    this.set_property_value(PlaygroundDocument.IdKey, id);
    this.set_property_value(PlaygroundDocument.TitleKey, title);
    this.set_property_value(PlaygroundDocument.VMKey, vm);
  }

  static blank(): PlaygroundDocument {
    return new PlaygroundDocument(`playground:${++seq}`, "Playground", new PlaygroundVM());
  }
  static forExample(entry: CorpusEntry): PlaygroundDocument {
    const vm = new PlaygroundVM();
    vm.load(entry);
    return new PlaygroundDocument(`playground:${++seq}`, entry.name, vm);
  }
  static forSources(sources: PackageSource[]): PlaygroundDocument {
    const vm = new PlaygroundVM();
    vm.loadSource(sources);
    return new PlaygroundDocument(`playground:${++seq}`, "Sources", vm);
  }
}
```

- [ ] **Step 3: Re-key the playground template to `DataTemplate[PlaygroundDocument]`**

Edit `src/renderer/modules/playground/playground.resources.mu`: change the resource-dictionary name to `PlaygroundResources` and make the template match `PlaygroundDocument`, binding the inner view to `$VM` (the existing template body that targeted `PlaygroundVM` now sits under a `ContentControl [ Content = $VM ]`, or re-root the existing markup with `DataContext = $VM`). Concretely:

```
import PlaygroundDocument from "./playground-document.ts"

resources PlaygroundResources {
    DataTemplate [ DataType = PlaygroundDocument ] {
        // existing playground markup, but bound through the document's VM:
        ContentControl [ Content = $VM ]   // VM is a PlaygroundVM; its own DataTemplate renders it
    }
    // keep the existing DataTemplate [ DataType = PlaygroundVM ] { ...original body... }
}
```
(Keep the original `DataTemplate[PlaygroundVM]` with the editor/graph markup; the document template just hosts the VM. This preserves the whole existing playground view.)

- [ ] **Step 4: Write the module**

Create `src/renderer/modules/playground/playground.module.mu`:

```
// Playground module — contributes the PlaygroundDocument type (rendered by
// PlaygroundResources). Playground is CONTENT, not a rail capability; the
// "New Playground" rail action is pinned in main.ts, and other modules open
// PlaygroundDocuments (Gallery examples, Packages sources).
module PlaygroundModule [ Name = "Playground" ] {
}
```

- [ ] **Step 5: Typecheck the new/moved TS (no mount yet)**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL/app && npx tsc -p tsconfig.web.json --noEmit 2>&1 | grep -E "playground|registry" || echo "no playground/registry type errors"`
Expected: no errors referencing the moved playground files or the document (pre-existing unrelated errors, if any, are ignored — the mount/build gate is Task 3).

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
git add -A src/renderer/modules/playground/
git commit -m "feat(app): PlaygroundDocument + PlaygroundModule (playground page → module)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `app.mu` composition root + bootstrap — first mount

**Files:**
- Create: `renderer/app.mu`
- Rewrite: `renderer/main.ts`

**Interfaces:**
- Consumes: `PlaygroundModule`, `PlaygroundResources`, `RegistryClient`, framework `EditorShell`, `DocumentsContentHostService`, `ContentHostService`, `NavigationService`, `RailAction`, `HtmlTarget`, `Material`/`MaterialDark`.
- Produces: `export const app` (initialized `Application`) from `app.mu`.

- [ ] **Step 1: Write `app.mu` (Playground only, grown in later tasks)**

Create `src/renderer/app.mu`:

```
import Material from "@pragmatic-tech-ai/mural/resources/material"
import MaterialDark from "@pragmatic-tech-ai/mural/resources/material"
import EditorShell from "@pragmatic-tech-ai/mural/framework/shell/editor-shell.js"
import ContentHostService from "@pragmatic-tech-ai/mural/framework"
import DocumentsContentHostService from "@pragmatic-tech-ai/mural/framework"

import RegistryClient from "./services/registry/registry-client.ts"
import PlaygroundModule from "./modules/playground/playground.module.mu.js"
import PlaygroundResources from "./modules/playground/playground.resources.mu.js"

Application [ Theme = Material, Scheme = MaterialDark ] {
    .services: {
        RegistryClient
        DocumentsContentHostService -> ContentHostService
    }
    .modules: {
        PlaygroundModule
    }
    resources: {
        merge PlaygroundResources
        EditorShell x:root { }
    }
}
```
(If the compiler needs the exact token import spellings, mirror Plexus `app.mu` lines 30/210-212 for the framework barrel imports.)

- [ ] **Step 2: Rewrite `main.ts` as a thin bootstrap**

Replace `src/renderer/main.ts`:

```ts
// @ts-expect-error compiled by vitePluginMural
import { app } from "./app.mu";
import { HtmlTarget } from "@pragmatic-tech-ai/mural/visual-engine";
import { ContentHostService, type DocumentsContentHostService } from "@pragmatic-tech-ai/mural/framework";
import { NavigationService } from "@pragmatic-tech-ai/mural/framework";
import { RailAction } from "@pragmatic-tech-ai/mural/framework";
import { RelayCommand } from "@pragmatic-tech-ai/mural/runtime";
import { initTodlEditor } from "./editor/todl-editor.js";
import { PlaygroundDocument } from "./modules/playground/playground-document.js";

initTodlEditor();

await document.fonts.ready;
app.initialize(new HtmlTarget(document.getElementById("app")!));

const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
// Seed a blank playground as the initial content.
host.Open(PlaygroundDocument.blank());

// Pin the "New Playground" rail header action (ShellModule has no rail-action
// field, so — like Plexus's scheme-picker — it's wired here).
const nav = app.Services.getRequired(NavigationService.Key);
const newPlayground = new RailAction();
newPlayground.Command = new RelayCommand(() => host.Open(PlaygroundDocument.blank()));
// (Icon/Label per RailAction's surface; see Plexus register-scheme-picker.ts.)
nav.HeaderActions.Add(newPlayground);
```
(Consult `Plexus/src/renderer/src/theme/register-scheme-picker.ts` for the exact `RailAction` construction — Icon/label/command properties — and mirror it.)

- [ ] **Step 3: Build the app (mount gate)**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL/app && npx electron-vite build 2>&1 | tail -20`
Expected: build succeeds; `app.mu` compiles (Application/module/services grammar). If a framework token import spelling is rejected, align it with Plexus `app.mu`.

- [ ] **Step 4: e2e smoke — the shell mounts with a playground document**

Run the existing launch smoke, updated if needed: `cd /c/Users/Eugene/Projects/architecture-agent/TODL/app && npx playwright test tests/smoke/launch.spec.ts`
Expected: the window opens, the renderer mounts, and the EditorShell + a Playground document tab are present. (Update the launch spec's selector to assert an EditorShell region / the Monaco editor if the old assertion referenced the AppVM DockPanel.)

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
git add -A src/renderer/app.mu src/renderer/main.ts
git commit -m "feat(app): app.mu composition root + EditorShell bootstrap (Playground mounts)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: GalleryModule (capability → opens Playground documents)

**Files:**
- Move: `renderer/pages/gallery/*` → `renderer/modules/gallery/` (gallery-vm.ts, gallery-card-vm.ts, gallery.mu → gallery.resources.mu)
- Create: `renderer/modules/gallery/services/gallery-service.ts`
- Create: `renderer/modules/gallery/gallery.module.mu`
- Edit: `app.mu` (add module + resources merge)

**Interfaces:**
- Consumes: `GalleryVM` logic (corpus list), `ContentHostService`, `PlaygroundDocument.forExample`.
- Produces: `class GalleryService extends ServiceBase { static readonly Key: ServiceKey<GalleryService>; get Items(): …; Selected accessor that opens a Playground document }`.

- [ ] **Step 1: Move the gallery page**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
mkdir -p src/renderer/modules/gallery/services
git mv src/renderer/pages/gallery/gallery-vm.ts       src/renderer/modules/gallery/services/gallery-service.ts
git mv src/renderer/pages/gallery/gallery-card-vm.ts   src/renderer/modules/gallery/gallery-card-vm.ts
git mv src/renderer/pages/gallery/gallery.mu           src/renderer/modules/gallery/gallery.resources.mu
```

- [ ] **Step 2: Turn `GalleryVM` into `GalleryService`**

Edit `src/renderer/modules/gallery/services/gallery-service.ts`:
- Rename the class `GalleryVM` → `GalleryService`, extend `ServiceBase`, add `static readonly Key = new ServiceKey<GalleryService>("GalleryService")` and `constructor(provider: IServiceProvider) { super(provider); ...existing item-list setup... }`.
- The old ctor took an `onOpen` callback; replace it with a provider resolve. Where it previously called `this.onOpen(entry)`, call:
  ```ts
  (this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService)
    .Open(PlaygroundDocument.forExample(entry));
  ```
- Keep the corpus `Items` DP + selection listener; only the open-action target changes.
- Imports: `ServiceBase, ServiceKey, type IServiceProvider` from runtime; `ContentHostService, type DocumentsContentHostService` from framework; `PlaygroundDocument` from `../../playground/playground-document.js`.

- [ ] **Step 3: Re-key the gallery template + write the module**

Edit `gallery.resources.mu`: dictionary name `GalleryResources`, `DataTemplate [ DataType = GalleryService ]` (was `GalleryVM`), body unchanged (it renders the corpus card list + selection).

Create `src/renderer/modules/gallery/gallery.module.mu`:

```
import GalleryService from "./services/gallery-service.ts"

module GalleryModule [ Name = "Gallery" ] {
    .services: { GalleryService }
    Capability [ Name = "Gallery", Icon = @Gallery, ServiceKey = GalleryService ]
}
```
(If no `@Gallery` icon geometry exists in the app yet, add one to a shared icons dictionary merged in `app.mu`, mirroring Plexus `plexus-icons.mu`; or omit `Icon` for now — `NavigationService` tolerates a missing icon.)

- [ ] **Step 4: Wire into `app.mu`**

Edit `src/renderer/app.mu`: add `import GalleryModule …` + `import GalleryResources …`; add `GalleryModule` to `.modules:` and `merge GalleryResources` to `resources:`.

- [ ] **Step 5: Build + e2e**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL/app && npx electron-vite build 2>&1 | tail -5`
Expected: build succeeds.
Then a focused e2e (new `tests/smoke/gallery.spec.ts`): the rail shows a "Gallery" destination; selecting it populates the side pane with corpus rows; clicking a row opens a Playground document tab whose editor shows that example's source.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
git add -A src/renderer/modules/gallery/ src/renderer/app.mu
git commit -m "feat(app): GalleryModule — side-pane corpus list opens Playground documents

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: PackagesModule (master list → PackageDocument detail)

**Files:**
- Move: `renderer/pages/packages/*` → `renderer/modules/packages/` (packages-vm.ts → services/packages-service.ts, package-item-vm.ts, package-detail-vm.ts, packages.mu → packages.resources.mu)
- Create: `renderer/modules/packages/package-document.ts`
- Create: `renderer/modules/packages/packages.module.mu`
- Edit: `app.mu`

**Interfaces:**
- Consumes: `RegistryClient` (via provider), `ContentHostService`, `PlaygroundDocument.forSources`, existing `PackageItemVM`/`PackageDetailVM`.
- Produces:
  - `class PackagesService extends ServiceBase { static readonly Key; get Items; Selected → opens PackageDocument; load() }`
  - `class PackageDocument extends MuralBase implements IDocument { static for(name, detail): …; readonly Detail: PackageDetailVM }`

- [ ] **Step 1: Move the packages page**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
mkdir -p src/renderer/modules/packages/services
git mv src/renderer/pages/packages/packages-vm.ts       src/renderer/modules/packages/services/packages-service.ts
git mv src/renderer/pages/packages/package-item-vm.ts    src/renderer/modules/packages/package-item-vm.ts
git mv src/renderer/pages/packages/package-detail-vm.ts  src/renderer/modules/packages/package-detail-vm.ts
git mv src/renderer/pages/packages/packages.mu           src/renderer/modules/packages/packages.resources.mu
```

- [ ] **Step 2: `PackageDocument` (IDocument wrapping the detail VM)**

Create `src/renderer/modules/packages/package-document.ts`:

```ts
import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";
import type { IDocument } from "@pragmatic-tech-ai/mural/framework";
import type { PackageDetailVM } from "./package-detail-vm.js";

/** A package's detail (facets + sources action) as a read-only Content tab. */
export class PackageDocument extends MuralBase implements IDocument {
  static readonly IdKey = MuralBase.RegisterProperty<string>(PackageDocument, "Id", "", MetaData.None);
  static readonly TitleKey = MuralBase.RegisterProperty<string>(PackageDocument, "Title", "", MetaData.None);
  static readonly DetailKey = MuralBase.RegisterProperty<PackageDetailVM>(PackageDocument, "Detail", undefined as unknown as PackageDetailVM, MetaData.None);

  get Id(): string { return this.get_property_value(PackageDocument.IdKey); }
  get Title(): string { return this.get_property_value(PackageDocument.TitleKey); }
  get Detail(): PackageDetailVM { return this.get_property_value(PackageDocument.DetailKey); }
  get IsDirty(): boolean { return false; }
  Save(): void {}

  constructor(name: string, detail: PackageDetailVM) {
    super();
    this.set_property_value(PackageDocument.IdKey, `package:${name}`);
    this.set_property_value(PackageDocument.TitleKey, name);
    this.set_property_value(PackageDocument.DetailKey, detail);
  }
}
```

- [ ] **Step 3: `PackagesService` (master; opens the detail document)**

Edit `services/packages-service.ts`: rename `PackagesVM` → `PackagesService extends ServiceBase`, add `static readonly Key`, `constructor(provider)`. Replace the injected `client`/`onOpen`/`onConfigure` ctor params with provider resolves:
- `private get client(): RegistryClient { return this.Provider.getRequired(RegistryClient.Key); }`
- `private get host(): DocumentsContentHostService { return this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService; }`
- On selection (the existing `SelectedKey` listener): build a `PackageDetailVM(this.client, this.scope, (name) => this.openSources(name))`, then `this.host.Open(new PackageDocument(sel.name, detail))` — dedupe by `ActivateById(\`package:${sel.name}\`)` first.
- `private openSources(name: string): void { void this.client.getSources({ name }).then((s) => this.host.Open(PlaygroundDocument.forSources(s))); }` (replaces the old `onOpen`).
- `onConfigure` (the "open Setup" affordance) → resolve the settings launcher instead. Minimal: drop the inline affordance here; the token-missing message stays, and Setup is reached via the gear (Task 8). Keep `load()` as-is (token/list/kind-badge logic unchanged).

Update `PackageDetailVM`'s `onOpen` usage to accept the same `(name) => void` callback (unchanged signature).

- [ ] **Step 4: Re-key templates + module**

Edit `packages.resources.mu`: name `PackagesResources`; `DataTemplate [ DataType = PackagesService ]` for the master (side pane); add `DataTemplate [ DataType = PackageDocument ]` for the detail (Content), binding `$Detail` (its existing `PackageDetailVM` template body is reused via `ContentControl [ Content = $Detail ]`). Keep the existing `DataTemplate[PackageDetailVM]`.

Create `packages.module.mu`:

```
import PackagesService from "./services/packages-service.ts"

module PackagesModule [ Name = "Packages" ] {
    .services: { PackagesService }
    Capability [ Name = "Packages", Icon = @Packages, ServiceKey = PackagesService ]
}
```

- [ ] **Step 5: Wire into `app.mu`; build + e2e**

Add `PackagesModule` + `merge PackagesResources` to `app.mu`.
Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL/app && npx electron-vite build 2>&1 | tail -5` — expect success.
Retarget `tests/smoke/packages-page.spec.ts` to the new shell: select the "Packages" rail destination → side pane lists packages (with the injected `__todlBridge` fake) → selecting a package opens a `PackageDocument` tab showing the 4 facets; the no-token case shows the settings message.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
git add -A src/renderer/modules/packages/ src/renderer/app.mu tests/
git commit -m "feat(app): PackagesModule — master list opens PackageDocument detail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: DocsModule (section list → DocsDocument)

**Files:**
- Move: `renderer/pages/docs/*` → `renderer/modules/docs/` (docs-vm.ts → services/docs-service.ts, docs-section-vm.ts, docs.mu → docs.resources.mu)
- Create: `renderer/modules/docs/docs-document.ts`
- Create: `renderer/modules/docs/docs.module.mu`
- Edit: `app.mu`

**Interfaces:**
- Produces: `class DocsService extends ServiceBase { static readonly Key; get Sections; Selected → opens/activates a DocsDocument }`; `class DocsDocument extends MuralBase implements IDocument { constructor(section) }`.

- [ ] **Step 1: Move the docs page**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
mkdir -p src/renderer/modules/docs/services
git mv src/renderer/pages/docs/docs-vm.ts          src/renderer/modules/docs/services/docs-service.ts
git mv src/renderer/pages/docs/docs-section-vm.ts   src/renderer/modules/docs/docs-section-vm.ts
git mv src/renderer/pages/docs/docs.mu              src/renderer/modules/docs/docs.resources.mu
```

- [ ] **Step 2: `DocsDocument` + `DocsService`**

Create `docs-document.ts` mirroring `PackageDocument` (Id `docs:<section>`, Title = section title, `Detail`/`Section` DP = the `DocsSectionVM`, `IsDirty=false`, `Save(){}`).

Edit `services/docs-service.ts`: `DocsVM` → `DocsService extends ServiceBase` (+ `Key`, `constructor(provider)`); the section list stays; on section select, `this.host.Open(new DocsDocument(section))` with `ActivateById` dedupe (`this.host` resolved as in Task 5). If Docs today renders all sections inline (no selection), keep a single `DocsDocument` opened when the capability is first shown — but the side pane should list sections; wire the existing section collection to the side-pane template and open a document per section.

- [ ] **Step 3: Templates + module + app.mu**

`docs.resources.mu`: name `DocsResources`; `DataTemplate[DocsService]` (side-pane section list) + `DataTemplate[DocsDocument]` (Content, reusing the existing section markup via `$Section`).

Create `docs.module.mu`:
```
import DocsService from "./services/docs-service.ts"
module DocsModule [ Name = "Docs" ] {
    .services: { DocsService }
    Capability [ Name = "Docs", Icon = @Docs, ServiceKey = DocsService ]
}
```
Add `DocsModule` + `merge DocsResources` to `app.mu`.

- [ ] **Step 4: Build + e2e**

Run: `npx electron-vite build` — expect success. Add `tests/smoke/docs.spec.ts`: rail shows "Docs"; selecting it lists sections; selecting a section opens a DocsDocument tab rendering that section.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
git add -A src/renderer/modules/docs/ src/renderer/app.mu tests/
git commit -m "feat(app): DocsModule — section list opens DocsDocument

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: PublishModule (rail footer action)

**Files:**
- Move: `renderer/pages/publish/publish-vm.ts` → `renderer/modules/publish/services/publish-service.ts` (publish.mu → publish.resources.mu only if it has reusable templates; otherwise delete the page view)
- Create: `renderer/modules/publish/publish.module.mu`
- Edit: `app.mu` (register service), `main.ts` (pin footer action)

**Interfaces:**
- Produces: `class PublishService extends ServiceBase { static readonly Key; get PublishCommand(): ICommand }` — command runs `client.pickDirectory()` then `client.publishDir(dir)`.

- [ ] **Step 1: Move + convert to a command service**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
mkdir -p src/renderer/modules/publish/services
git mv src/renderer/pages/publish/publish-vm.ts src/renderer/modules/publish/services/publish-service.ts
```
Edit `publish-service.ts`: `PublishVM` → `PublishService extends ServiceBase` (+ `Key`, `constructor(provider)`); expose `PublishCommand` (a `RelayCommand`) whose handler is the existing publish flow, resolving the client via `this.Provider.getRequired(RegistryClient.Key)`: `const dir = await client.pickDirectory(); if (dir) await client.publishDir(dir);` plus the existing status handling as observable state if the flow surfaces progress.
Handle `publish.mu`: if it only rendered the old full page, delete it (`git rm src/renderer/pages/publish/publish.mu`); the footer action needs no page. If it has a reusable dialog/toast template, move it to `publish.resources.mu` and merge in app.mu.

- [ ] **Step 2: Module + registration + footer action**

Create `publish.module.mu`:
```
import PublishService from "./services/publish-service.ts"
module PublishModule [ Name = "Publish" ] {
    .services: { PublishService }
}
```
Add `PublishModule` to `app.mu` `.modules:`. In `main.ts`, pin a footer action mirroring the header one:
```ts
import { PublishService } from "./modules/publish/services/publish-service.js";
const publish = new RailAction();
publish.Command = app.Services.getRequired(PublishService.Key).PublishCommand;
nav.FooterActions.Add(publish);
```

- [ ] **Step 3: Build + e2e**

Run: `npx electron-vite build` — expect success. In the retargeted `setup-publish.spec.ts`, drive the footer "Publish" action with the injected bridge fake (pickDirectory returns a path; assert `publishDir` was called).

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
git add -A src/renderer/modules/publish/ src/renderer/app.mu src/renderer/main.ts
git commit -m "feat(app): PublishModule — rail footer action (pick dir → publishDir)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: SetupModule (settings-gear contribution)

**Files:**
- Move: `renderer/pages/setup/*` → `renderer/modules/setup/` (setup-vm.ts, setup.mu → setup.resources.mu)
- Create: `renderer/modules/setup/services/setup-contribution.ts`
- Create: `renderer/modules/setup/setup.module.mu`
- Edit: `app.mu` (bind contribution to the framework settings key)

**Interfaces:**
- Consumes: framework `SettingsContributionKey`, `RegistryClient`, existing `SetupVM`.
- Produces: `class SetupContribution { CreateView(): MuralBase }` returning the Setup view bound to a `SetupVM`.

- [ ] **Step 1: Move the setup page**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
mkdir -p src/renderer/modules/setup/services
git mv src/renderer/pages/setup/setup-vm.ts  src/renderer/modules/setup/services/setup-vm.ts
git mv src/renderer/pages/setup/setup.mu      src/renderer/modules/setup/setup.resources.mu
```

- [ ] **Step 2: Settings contribution**

Read `Plexus/src/renderer/src/services/settings/settings-contribution.ts` for the exact `SettingsContribution` shape (the `CreateView()` + gear-icon/label surface + the framework `SettingsContributionKey` token). Create `services/setup-contribution.ts` following it: `CreateView()` constructs the Setup view (the moved `DataTemplate[SetupVM]`) over a `SetupVM` built with a provider-resolved `RegistryClient`. `SetupVM` keeps its current logic (registry/scope/org fields, stored-token box, env-var combobox from `client.listEnvVars()`), only its `RegistryClient` source changes to the provider.

- [ ] **Step 3: Module + app.mu binding**

Create `setup.module.mu` (registers `SetupContribution` in `.services:`; no capability). In `app.mu`, bind it to the framework key (mirroring Plexus `PlexusSettingsContribution -> SettingsContributionKey` at app.mu:254) so the EditorShell footer gear presents `CreateView()`. Import `SettingsContributionKey` from the framework barrel as Plexus does (app.mu:212). Merge `SetupResources`.

- [ ] **Step 4: Build + e2e**

Run: `npx electron-vite build` — expect success. In `setup-publish.spec.ts`, click the footer gear → the Setup view appears with the token status + env-var combobox; assert set-token / use-env-var round-trip against the injected bridge fake.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
git add -A src/renderer/modules/setup/ src/renderer/app.mu
git commit -m "feat(app): SetupModule — settings-gear contribution (token + env-var)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Delete `AppVM` + `shell.mu`, prune `pages/`, full verification, finish

**Files:**
- Delete: `renderer/app-vm.ts`, `renderer/shell.mu`, the now-empty `renderer/pages/` and `renderer/services/tests/` (old locations), and any dead `pages/*` leftovers.

- [ ] **Step 1: Delete the dead composition + confirm no importers**

```bash
cd /c/Users/Eugene/Projects/architecture-agent/TODL/app
git rm src/renderer/app-vm.ts src/renderer/shell.mu
# remove empty old dirs if git leaves them:
rm -rf src/renderer/pages src/renderer/services/registry-client.ts 2>/dev/null || true
git grep -n "app-vm\|shell.mu\|from \"./pages/\|services/registry-client" -- src || echo "clean — no dangling references"
```
Expected: `clean`. Fix any straggler import.

- [ ] **Step 2: Full build**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL/app && npx electron-vite build 2>&1 | tail -20`
Expected: build succeeds (all three sections).

- [ ] **Step 3: Full app unit + e2e**

Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL/app && npx tsx --test "src/**/tests/*.test.ts"` — expect the RegistryClient suite (and any other unit suites) green.
Run: `cd /c/Users/Eugene/Projects/architecture-agent/TODL/app && npx playwright test` — expect launch + gallery + packages + docs + setup-publish specs green against the new shell.

- [ ] **Step 4: Finish the branch**

Use the **superpowers:finishing-a-development-branch** skill: verify the suites are green on the merge result, present the merge/PR/keep options; per the standing "don't push unless asked" rule, do not push unless the user picks the PR option.

---

## Self-Review

**Spec coverage:**
- `app.mu` root with `.services:`/`.modules:`/`resources:` + EditorShell → Task 3. ✓
- Service provider + `ServiceBase` + `Key` convention → Tasks 1, 4–8. ✓
- RegistryClient → root service → Task 1. ✓
- Playground = document (+ New Playground rail action) → Tasks 2, 3. ✓
- Gallery = capability opening Playground docs → Task 4. ✓
- Packages = capability master → PackageDocument detail + open-sources → Task 5. ✓
- Docs = capability → DocsDocument → Task 6. ✓
- Publish = rail footer action → Task 7. ✓
- Setup = settings-gear contribution → Task 8. ✓
- Cross-page flows via provider (open-in-playground, master/detail) → Tasks 4, 5. ✓
- Delete AppVM + shell.mu → Task 9. ✓
- Testing: RegistryClient unit + e2e per capability + electron-vite build gate → Tasks 1, 3–9. ✓

**Placeholder scan:** Ported files use concrete git mv + specific edits (base class, Key, ctor, provider resolves) — not vague "implement later". Template re-keying names the exact DataType change. No TBD/TODO.

**Type consistency:** `X.Key` (`ServiceKey<X>`) + class-as-token in `.module.mu` `ServiceKey =` match across services; `ContentHostService.Key` resolved `as DocumentsContentHostService` uniformly; `IDocument` members (`Id`/`Title`/`IsDirty`/`Save`) identical across PlaygroundDocument/PackageDocument/DocsDocument; `PlaygroundDocument.forExample/forSources/blank` names match their call sites in GalleryService/PackagesService/main.ts.

**Known verification points (flagged, not placeholders):** (a) framework barrel import spellings in `app.mu` — mirror Plexus `app.mu`; (b) `RailAction` Icon/label surface — mirror Plexus `register-scheme-picker.ts`; (c) `SettingsContribution` shape — mirror Plexus `settings-contribution.ts`. Each names the exact reference file to copy the idiom from.
