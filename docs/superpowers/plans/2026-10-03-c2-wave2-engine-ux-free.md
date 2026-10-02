# C2 Wave 2 — TODL engine made UX-free + engine BuildService Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip the todl engine of every `@pragmatic-tech-ai/mural/framework` dependency within its `solution-services` scope (goal 3), and give build/publish a UX-free engine home (`BuildService`), so the UI in later waves does nothing functional.

**Architecture:** Five moves inside TODL only (`@pragmatic-tech-ai/todl`): (1) retarget the three settings "bags" to the todl-runtime 0.7.0 `SettingDefinition`/`SettingKind` schema; (2) dissolve the two presentation-band types (`SettingBagGrid`, `SolutionTreeVM`) — their behavior is re-expressed in plexus-core in Wave 4; (3) remove the `ProjectContentProvider` `IHierarchyProvider` adapter, keeping the mural-free `ProjectContentStore`/`ContentChange`/`ProjectContentNode` data; (4) add an engine-pure `BuildService` (relocating plexus-core's `PackagePublisher` orchestration down, plus the two zero-dep storage helpers it needs); (5) broaden the engine boundary guard to forbid `mural/framework` across all of `solution-services`. Nothing in Plexus is touched (Plexus stays on its pinned todl until Wave 4). todl publishes once at the end of this wave.

**Tech Stack:** TypeScript (ESM), `tsx --test` (node test runner), workspace **symlinked** peer deps (`@pragmatic-tech-ai/todl-runtime` → local repo at 0.7.0; `@pragmatic-tech-ai/mural` → local at 0.60.0).

**Spec:** `C:\Users\Eugene\Projects\architecture-agent\Plexus\docs\superpowers\specs\2026-10-02-plexus-project-explorer-migration-design.md` (Section 1 "Out of todl"/"Into todl"; Section 4; Section 6 step 2; Guards; DR3/DR5/DR6/DR7/DR8).

## Global Constraints

- **Do NOT run `npm install` in TODL.** Peer packages are workspace **symlinks**; `npm install` breaks them. The `todl-runtime` symlink already resolves to the local 0.7.0 build (verified: `node_modules/@pragmatic-tech-ai/todl-runtime/dist/index.d.ts` exports `SettingDefinition`). The `package.json` dependency bump in Task 1 is metadata only (for the eventual publish); it needs no install.
- **Scope = `src/solution-services/` only** (which contains the settings bags, the content store, the solution-manager, and ALL build systems: `build-system-core/`, `todl-build-system/`). The todl standalone **model-browser app** under `src/application/` (and `graph-api/browser`) genuinely uses mural and is **out of C2 scope** — leave it and its mural imports alone. **RULING:** the `@pragmatic-tech-ai/mural` dependency STAYS in `package.json` (the model-browser app + the build bootstrappers need it); Wave 2 removes `mural/framework` only from `solution-services`, enforced by the Task 5 guard. Full mural-dep removal awaits the model-browser migration (future work, not C2). Cost if wrong: the literal spec line "drop the mural dep" is only partially met this wave; the engine's solution-services scope is fully mural/framework-free, which is the goal-3 substance.
- **Bootstrapper exception:** files importing `@pragmatic-tech-ai/mural/compiler` (`mural-compiler.ts`, `presentation-bake.ts`), `@pragmatic-tech-ai/mural/runtime` (the `*.mu.js` composition modules — `Module`/`ServiceProvider`), stay as-is. The forbidden import is specifically `@pragmatic-tech-ai/mural/framework`.
- **Browser-safe split preserved:** the main barrel (`src/index.ts`) must stay browser-safe (no `node:*`, no esbuild edge). New engine code (`BuildService` + storage helpers) is browser-safe by construction (uses `FakeStorage`, core, package-manager — no node/esbuild) and is exported from the main barrel. The node-only html-bundle path stays quarantined on `./project-system`.
- **House style:** OOP; Allman braces (one-line `if (x) return;` + block-bodied arrows/object literals inline); no inline reused literals (hoist to `private static readonly` PascalCase); PascalCase interfaces/public methods; `Observable` VMs; `IDisposable` teardown.
- **Pre-existing baseline:** TODL's `npm test` is RED at baseline (main) with failures unrelated to this wave — the `application/*` mural-render tests (headless env), the `html-bundle`/`bundle-app-action` node+esbuild tests, `browser-safe-composition`, and the `content-provider*`/`content-store-realfs` tests (removed/rewritten here). The authoritative baseline-failure list is pinned in the SDD ledger. **Per-task gate:** the files the task touches are green and the task introduces NO NEW failure beyond the pinned baseline. Run `npm run gen:prelude && npm run gen:scaffold && npm run compile:mu` once before testing if generated sources are stale (the test script has no pretest hook). Single file: `npx tsx --conditions=development --test <path>`.

## Review Focus

1. **No `mural/framework` left in `solution-services`** after Tasks 1–4 — Task 5's broadened guard asserts zero offenders across `src/solution-services/**/*.ts`.
2. **Settings shape parity** — the retargeted bags build `SettingDefinition` via the same PascalCase accessors (`Key`/`Label`/`Category`/`Default`/`Kind`) and `SettingKind.String`/`.Boolean`; todl-runtime's enum values are identical, so no behavior change. Covered by the existing `bag-definition-registry`/`solution-settings-values` tests (retargeted) staying green.
3. **Publish registry fallback** — `BuildService.Publish` uses `SolutionManagerService.PublishRegistry` when set, else the `LocalNpmRegistry(ScopeFlatteningStorage(store.Storage))` fallback; Task 4's test pins both branches.
4. **`PublishOutcome` identity mapping** — `Id = manifest.id ?? manifest.name ?? '(unknown)'`, `Version = manifest.packageVersion ?? ''`, `Ok`/`Diagnostics` from the build result; Task 4 test pins it.
5. **Content store survives provider removal** — removing `ProjectContentProvider` must not touch `ProjectContentStore`/`ContentChange`/`ProjectContentNode`; the store's own tests (rewritten to assert `ContentChange` directly) stay green.
6. **Main barrel stays browser-safe** — `BuildService` export adds no node/esbuild edge.

---

### Task 1: Retarget the settings bags to todl-runtime 0.7.0

**Files:**
- Modify: `package.json` (dependency version only)
- Modify: `src/solution-services/solution-manager/engine/setting-bag-definition.ts:1`
- Modify: `src/solution-services/todl-build-system/todl-build-settings.ts:1`
- Modify: `src/solution-services/property-bags/connection-bag.ts:2`
- Modify (test imports): `src/solution-services/solution-manager/engine/tests/bag-definition-registry.test.ts:3`, `src/solution-services/solution-manager/engine/tests/solution-settings-values.test.ts:4`

**Interfaces:**
- Consumes: `SettingDefinition` (class, PascalCase accessors `Key`/`Label`/`Description`/`Category`/`Kind`/`Default`/`Choices`/`Min`/`Max`) and `SettingKind` (enum `Boolean`/`Number`/`String`/`Choice`/`Color`/`FilePath`) from `@pragmatic-tech-ai/todl-runtime` (0.7.0, via symlink).
- Produces: identical bag behavior; after this task `setting-bag-definition.ts`, `todl-build-settings.ts`, `connection-bag.ts` no longer import `@pragmatic-tech-ai/mural/framework`.

- [ ] **Step 1: Verify the symlinked runtime exposes the types (sanity, not a change)**

Run: `node -p "Object.keys(require('@pragmatic-tech-ai/todl-runtime')).filter(k=>/Setting/.test(k))"` from the TODL dir.
Expected: prints `[ 'SettingDefinition', 'SettingKind' ]` (confirms the symlink serves 0.7.0). If it prints `[]`, STOP — the symlink is stale; report BLOCKED (do not npm install).

- [ ] **Step 2: Bump the dependency metadata**

In `package.json`, change the `@pragmatic-tech-ai/todl-runtime` dependency from `"^0.5.8"` to `"^0.7.0"`. Do NOT run `npm install`.

- [ ] **Step 3: Retarget the three bag imports**

- `setting-bag-definition.ts:1`: replace `import { type SettingDefinition } from '@pragmatic-tech-ai/mural/framework'` with `import { type SettingDefinition } from '@pragmatic-tech-ai/todl-runtime'`.
- `todl-build-settings.ts:1`: replace `import { SettingDefinition, SettingKind } from "@pragmatic-tech-ai/mural/framework";` with `import { SettingDefinition, SettingKind } from "@pragmatic-tech-ai/todl-runtime";`.
- `connection-bag.ts:2`: replace `import { SettingDefinition, SettingKind } from '@pragmatic-tech-ai/mural/framework';` with `import { SettingDefinition, SettingKind } from '@pragmatic-tech-ai/todl-runtime';`.

Change ONLY the import specifier on each; leave all usage untouched (the accessors/enum are shape-identical).

- [ ] **Step 4: Retarget the two engine test imports**

In `bag-definition-registry.test.ts:3` and `solution-settings-values.test.ts:4`, change the `{ SettingDefinition, SettingKind }` import specifier from `@pragmatic-tech-ai/mural/framework` to `@pragmatic-tech-ai/todl-runtime`.

- [ ] **Step 5: Run the affected tests + typecheck**

Run: `npx tsx --conditions=development --test "src/solution-services/solution-manager/engine/tests/bag-definition-registry.test.ts" "src/solution-services/solution-manager/engine/tests/solution-settings-values.test.ts" "src/solution-services/property-bags/tests/connection-bag.test.ts"` (include the connection-bag test if one exists; if not, omit).
Expected: PASS. Then `npx tsc --noEmit` — Expected: 0 errors (the three retargeted modules + tests compile against todl-runtime's types).

- [ ] **Step 6: Commit**

```bash
git add package.json src/solution-services/solution-manager/engine/setting-bag-definition.ts src/solution-services/todl-build-system/todl-build-settings.ts src/solution-services/property-bags/connection-bag.ts src/solution-services/solution-manager/engine/tests/bag-definition-registry.test.ts src/solution-services/solution-manager/engine/tests/solution-settings-values.test.ts
git commit -m "refactor(todl): retarget settings bags to todl-runtime SettingDefinition/SettingKind"
```
(End the message body with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.)

---

### Task 2: Dissolve the presentation-band types (`SettingBagGrid`, `SolutionTreeVM`)

**Files:**
- Delete: `src/solution-services/solution-manager/presentation/setting-bag-grid.ts`
- Delete: `src/solution-services/solution-manager/presentation/solution-tree-vm.ts`
- Delete: `src/solution-services/solution-manager/presentation/tests/setting-bag-grid.test.ts`
- Delete: `src/solution-services/solution-manager/presentation/tests/solution-tree-vm.test.ts`
- Modify: `src/index.ts` (remove the barrel exports at ~214 for `SettingBagGrid` and ~208-213 for `SolutionTreeVM`/`SolutionNodeVM`/`SolutionMemberNodeVM`/`MemberStorageFor`)

**Interfaces:**
- Produces: `SettingBagGrid`, `SolutionTreeVM`, `SolutionNodeVM`, `SolutionMemberNodeVM`, `MemberStorageFor` are no longer exported from `@pragmatic-tech-ai/todl`. (Their behavior is re-expressed in plexus-core in Wave 4: `SettingBagGrid` → the settings-editor view; `SolutionTreeVM` → `ProjectHierarchyProvider`/contributors.)

- [ ] **Step 1: Confirm the blast radius (read-only)**

Run: `grep -rn "SettingBagGrid\|SolutionTreeVM\|SolutionNodeVM\|SolutionMemberNodeVM\|MemberStorageFor" src/ --include=*.ts | grep -v "/presentation/setting-bag-grid.ts\|/presentation/solution-tree-vm.ts\|/presentation/tests/"`
Expected: only the barrel lines in `src/index.ts` (and possibly a comment in `engine/solution.ts`). If any NON-test, non-barrel engine consumer appears, STOP and report — the dissolve would break it.

- [ ] **Step 2: Delete the four files**

Delete `setting-bag-grid.ts`, `solution-tree-vm.ts`, and their two test files listed above.

- [ ] **Step 3: Remove the barrel exports**

In `src/index.ts`, delete the `export { SettingBagGrid } …` line and the `export { SolutionTreeVM, SolutionNodeVM, SolutionMemberNodeVM, type MemberStorageFor } …` line(s). If a section comment references them, update it.

- [ ] **Step 4: Typecheck + the presentation area**

Run: `npx tsc --noEmit`
Expected: 0 errors (nothing non-test referenced the deleted types). If tsc reports an unexpected consumer, that consumer must be handled — report it as a finding rather than guessing.

- [ ] **Step 5: Commit**

```bash
git add -A src/solution-services/solution-manager/presentation src/index.ts
git commit -m "refactor(todl): dissolve SettingBagGrid/SolutionTreeVM presentation types (re-expressed in plexus-core)"
```
(+ attribution trailer.)

---

### Task 3: Remove the `ProjectContentProvider` IHierarchyProvider adapter

**Files:**
- Delete: `src/solution-services/project-services/content/project-content-provider.ts`
- Delete: `src/solution-services/project-services/content/tests/content-provider.test.ts`
- Delete: `src/solution-services/project-services/content/tests/content-provider-drop.test.ts`
- Delete: `src/solution-services/project-services/content/tests/content-store-harness.ts`
- Modify: `src/solution-services/project-services/content/tests/content-store-realfs.test.ts` (rewrite to assert `ContentChange` directly, dropping the mural hierarchy import)
- Modify: `src/index.ts` (remove the `ProjectContentProvider` barrel export at ~230)

**Interfaces:**
- Keep untouched (mural-free, stay in todl): `ProjectContentStore`, `ContentChange`/`ContentAdded`/`ContentUpdated`/`ContentRemoved`, `ProjectContentNode`/`ContentNodeId`, `ContentNodeKey`.
- Produces: `ProjectContentProvider` no longer exists in todl (it is rebuilt as `ProjectHierarchyProvider` in plexus-core in Wave 4). No todl engine code references `IHierarchyProvider` anymore.

- [ ] **Step 1: Read the three test files before deleting/rewriting**

Read `content-provider.test.ts`, `content-provider-drop.test.ts`, `content-store-harness.ts`, and `content-store-realfs.test.ts`. The first three test the provider adapter (mural translation) → delete. `content-store-realfs.test.ts` tests the STORE over a real filesystem but currently imports mural hierarchy deltas (`ChildAdded`/`ChildUpdated`/`ChildRemoved`) — it must be rewritten to assert the store's native `ContentChange` deltas instead. Determine from reading it exactly which store behaviors it covers (create/rename/delete/move reconciliation) so the rewrite preserves that coverage.

- [ ] **Step 2: Delete the provider + its three test/harness files**

Delete `project-content-provider.ts`, `content-provider.test.ts`, `content-provider-drop.test.ts`, `content-store-harness.ts`.

- [ ] **Step 3: Rewrite `content-store-realfs.test.ts` to assert `ContentChange`**

Replace the mural `@pragmatic-tech-ai/mural/framework/hierarchy` import with the store's own `ContentChange`/`ContentAdded`/`ContentUpdated`/`ContentRemoved` from `../content-change.js`. Subscribe to the store's change signal and assert the native deltas (kind + affected node/path) for each covered mutation, preserving the original behaviors (the real-fs create/rename/delete/move + watch reconciliation). Do not reintroduce any mural import. If the test used `content-store-harness.ts` helpers, inline the minimal store setup it needs.

- [ ] **Step 4: Remove the barrel export**

In `src/index.ts`, delete the `export { ProjectContentProvider } …` line (~230); update the neighbouring section comment that mentions "the IHierarchyProvider adapter".

- [ ] **Step 5: Run the content tests + typecheck**

Run: `npx tsx --conditions=development --test "src/solution-services/project-services/content/tests/content-store-realfs.test.ts"` plus any other surviving `content/tests/*.test.ts` (e.g. the store's own unit test if present).
Expected: PASS (the rewritten realfs test asserts `ContentChange`). Then `npx tsc --noEmit` — Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add -A src/solution-services/project-services/content src/index.ts
git commit -m "refactor(todl): remove ProjectContentProvider adapter; keep mural-free content store + ContentChange"
```
(+ attribution trailer.)

---

### Task 4: Engine-pure `BuildService` (relocate PackagePublisher orchestration down)

**Files:**
- Create: `src/solution-services/todl-build-system/build-service.ts` (`BuildService` + `PublishOutcome`)
- Create: `src/solution-services/todl-build-system/in-memory-build-storage.ts` (engine copy)
- Create: `src/solution-services/todl-build-system/scope-flattening-storage.ts` (engine copy)
- Create: `src/solution-services/todl-build-system/tests/build-service.test.ts`
- Modify: `src/index.ts` (export `BuildService`, `PublishOutcome`, and — for Wave 4 reuse — `InMemoryBuildStorage`, `ScopeFlatteningStorage` from the main barrel)

**Interfaces:**
- Consumes (all engine/peer, no plexus-core): `TodlProjectBuildManager`, `BuildSystemRegistryKey`, `PackageStoreKey`, `SolutionManagerService` (`.Key`, `.PublishRegistry: IPackageRegistry | undefined`), `LocalNpmRegistry`, `parseManifest`/`ProjectManifest`, `PROJECT_MANIFEST_FILENAME` (all on the todl main barrel / relative paths); `IStorage`/`FakeStorage` (todl-runtime); `IBuildProgress`, `ProjectBuildOutput`, `BuildDiagnostic`, `Severity`, `IBuildStorageProvider`, `OpenedOutput` (relative `../build-system-core/*`); `IServiceProvider` (`@pragmatic-tech-ai/mural/runtime` — allowed, not /framework).
- Produces: `export class BuildService` with `public static readonly Key`; `Build(project: IStorage, buildSystemId: string, flavorId?: string, progress?: IBuildProgress): Promise<ProjectBuildOutput>`; `Publish(project: IStorage, progress?: IBuildProgress): Promise<PublishOutcome>`; `static FormatErrors(diagnostics: readonly BuildDiagnostic[]): string`. `export interface PublishOutcome { readonly Ok: boolean; readonly Diagnostics: readonly BuildDiagnostic[]; readonly Id: string; readonly Version: string }`. (Solution-wide Build All / Publish All stay on the existing `SolutionBuildManager`; Wave 4 wires the UI to both.)

- [ ] **Step 1: Create the two engine storage helpers**

Create `in-memory-build-storage.ts` and `scope-flattening-storage.ts` as engine copies of the plexus-core originals (they have zero plexus-core dependencies). Imports become relative: `InMemoryBuildStorage` imports `FakeStorage`/`IStorage` from `@pragmatic-tech-ai/todl-runtime` and `IBuildStorageProvider`/`OpenedOutput` from `../build-system-core/index.js`; `ScopeFlatteningStorage` imports `IStorage`/`StorageEntry` from `@pragmatic-tech-ai/todl-runtime`. Verbatim bodies:

```ts
// in-memory-build-storage.ts
import { FakeStorage, type IStorage } from '@pragmatic-tech-ai/todl-runtime';
import { type IBuildStorageProvider, type OpenedOutput } from '../build-system-core/index.js';

// Each build gets a fresh in-memory sandbox and promotes into one in-memory
// output; nothing persists to disk — the publish flavor's terminal action
// pushes the staged package straight to the registry, so the promoted output
// is scratch and discarded with the process.
export class InMemoryBuildStorage implements IBuildStorageProvider
{
    private static readonly OutputPath = 'memory://build';

    private readonly output = new FakeStorage();

    public CreateSandbox(): Promise<IStorage>
    {
        return Promise.resolve(new FakeStorage());
    }

    public DeleteSandbox(_sandbox: IStorage): Promise<void>
    {
        return Promise.resolve();
    }

    public OpenOutput(_outputName: string): Promise<OpenedOutput>
    {
        return Promise.resolve({ Storage: this.output, Path: InMemoryBuildStorage.OutputPath });
    }
}
```

```ts
// scope-flattening-storage.ts — copy the plexus-core body verbatim, changing only
// the import to '@pragmatic-tech-ai/todl-runtime' (it already is). Full body:
import { type IStorage, type StorageEntry } from '@pragmatic-tech-ai/todl-runtime';

// An IStorage decorator that drops the leading npm scope segment (`@scope/`)
// from every path before delegating — a scoped publish lands at the bare-id
// path that local resolution reads ("resolution never keys off scope").
export class ScopeFlatteningStorage implements IStorage
{
    private static readonly ScopePrefix = '@';
    private static readonly Separator = '/';

    constructor(private readonly inner: IStorage)
    {
    }

    public get Root(): string { return this.inner.Root; }
    public ReadText(path: string): Promise<string> { return this.inner.ReadText(ScopeFlatteningStorage.Flatten(path)); }
    public ReadBytes(path: string): Promise<Uint8Array> { return this.inner.ReadBytes(ScopeFlatteningStorage.Flatten(path)); }
    public WriteText(path: string, content: string): Promise<void> { return this.inner.WriteText(ScopeFlatteningStorage.Flatten(path), content); }
    public WriteBytes(path: string, bytes: Uint8Array): Promise<void> { return this.inner.WriteBytes(ScopeFlatteningStorage.Flatten(path), bytes); }
    public Exists(path: string): Promise<boolean> { return this.inner.Exists(ScopeFlatteningStorage.Flatten(path)); }
    public Delete(path: string): Promise<void> { return this.inner.Delete(ScopeFlatteningStorage.Flatten(path)); }
    public CreateDirectory(path: string): Promise<void> { return this.inner.CreateDirectory(ScopeFlatteningStorage.Flatten(path)); }
    public Rename(from: string, to: string): Promise<void> { return this.inner.Rename(ScopeFlatteningStorage.Flatten(from), ScopeFlatteningStorage.Flatten(to)); }
    public List(path: string): Promise<readonly StorageEntry[]> { return this.inner.List(ScopeFlatteningStorage.Flatten(path)); }

    private static Flatten(path: string): string
    {
        if (!path.startsWith(ScopeFlatteningStorage.ScopePrefix)) return path;
        const slash = path.indexOf(ScopeFlatteningStorage.Separator);
        if (slash < 0) return path;
        return path.slice(slash + 1);
    }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/build-service.test.ts`. It builds a `ServiceProvider`, registers a FAKE `BuildSystemRegistry` under `BuildSystemRegistryKey` whose single `IBuildSystem` (id `'npm-package'`, `AppliesTo`→true) has a `'npm-publish'` flavor whose one action records the `TodlBuildContext.PublishRegistry` it received and reports no error (so the pipeline is light, no real compile), registers a fake `PackageStore` under `PackageStoreKey` (an `IPackageStore` wrapping a `FakeStorage`), and registers a `SolutionManagerService`. Assert:
  (a) `FormatErrors` joins only `Severity.Error` messages with `'; '`;
  (b) `Publish(projectStorage)` with `SolutionManagerService.PublishRegistry` SET routes to that registry (the recording action saw it) and returns `PublishOutcome { Ok:true, Id: manifest.id, Version: manifest.packageVersion }`;
  (c) `Publish` with `PublishRegistry` UNSET falls back to a `LocalNpmRegistry` (the recording action saw a non-undefined registry; assert `instanceof LocalNpmRegistry`).

Run: `npx tsx --conditions=development --test src/solution-services/todl-build-system/tests/build-service.test.ts`
Expected: FAIL — `build-service.js` does not exist yet.

Note to implementer: this is the judgment-heavy step. Read `build-system-core/build-system.ts` (`IBuildSystem`, `BuildFlavor`/`StaticBuildFlavor`, `IBuildAction`), `build-system-core/build-system-registry.ts` (`Register`/`Validate` — the fake must pass `Validate`), and `todl-build-context.ts` (`TodlBuildContext`, `TodlBuildRequest`) to construct the fake correctly. Keep the fake minimal.

- [ ] **Step 3: Write `BuildService`**

Create `build-service.ts`. Model `Publish` on plexus-core's `PackagePublisher.Publish` exactly (the orchestration is unchanged; only the home moves to the engine):

```ts
import { type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime';
import { type IStorage } from '@pragmatic-tech-ai/todl-runtime';
import { Severity, type BuildDiagnostic } from '../build-system-core/index.js';
import { type IBuildProgress } from '../build-system-core/index.js';
import { type ProjectBuildOutput } from '../build-system-core/index.js';
import { BuildSystemRegistryKey } from '../project-services/composition/build-system-registry-key.js';
import { PackageStoreKey } from './package-store.js';
import { SolutionManagerService } from '../solution-manager/engine/solution-manager-service.js';
import { LocalNpmRegistry } from '../package-manager/registries/npm/local-npm-registry.js';
import { parseManifest } from '../package-manager/manifest.js';
import { PROJECT_MANIFEST_FILENAME } from '../project-services/core/project-factory.js';
import { TodlProjectBuildManager } from './todl-project-build-manager.js';
import { InMemoryBuildStorage } from './in-memory-build-storage.js';
import { ScopeFlatteningStorage } from './scope-flattening-storage.js';

export interface PublishOutcome
{
    readonly Ok: boolean;
    readonly Diagnostics: readonly BuildDiagnostic[];
    readonly Id: string;
    readonly Version: string;
}

// The engine home for build/publish orchestration (was plexus-core's
// PackagePublisher). The UI calls these down and tracks progress via the
// supplied IBuildProgress; the engine does the work and never calls up.
export class BuildService
{
    public static readonly Key = new ServiceKey<BuildService>('BuildService');
    private static readonly NpmPackageBuildSystemId = 'npm-package';
    private static readonly PublishFlavorId = 'npm-publish';
    private static readonly DiagnosticSeparator = '; ';
    private static readonly UnknownId = '(unknown)';
    private static readonly NoVersion = '';

    constructor(private readonly provider: IServiceProvider)
    {
    }

    public async Build(project: IStorage, buildSystemId: string, flavorId?: string, progress?: IBuildProgress): Promise<ProjectBuildOutput>
    {
        const store = this.provider.getRequired(PackageStoreKey);
        const manifest = parseManifest(await project.ReadText(PROJECT_MANIFEST_FILENAME));
        const buildSystems = this.provider.getRequired(BuildSystemRegistryKey);
        const manager = new TodlProjectBuildManager(buildSystems, new InMemoryBuildStorage());
        return manager.Build({ Project: project, Manifest: manifest, BuildSystemId: buildSystemId, BuildFlavorId: flavorId, Source: store, Progress: progress });
    }

    public async Publish(project: IStorage, progress?: IBuildProgress): Promise<PublishOutcome>
    {
        const store = this.provider.getRequired(PackageStoreKey);
        const registry = this.provider.getRequired(SolutionManagerService.Key).PublishRegistry
            ?? new LocalNpmRegistry(new ScopeFlatteningStorage(store.Storage));
        const manifest = parseManifest(await project.ReadText(PROJECT_MANIFEST_FILENAME));
        const buildSystems = this.provider.getRequired(BuildSystemRegistryKey);
        const manager = new TodlProjectBuildManager(buildSystems, new InMemoryBuildStorage());
        const { Result: result } = await manager.Build({
            Project: project,
            Manifest: manifest,
            BuildSystemId: BuildService.NpmPackageBuildSystemId,
            BuildFlavorId: BuildService.PublishFlavorId,
            Source: store,
            PublishRegistry: registry,
            Progress: progress,
        });
        return {
            Ok: result.Ok,
            Diagnostics: result.Diagnostics,
            Id: manifest.id ?? manifest.name ?? BuildService.UnknownId,
            Version: manifest.packageVersion ?? BuildService.NoVersion,
        };
    }

    public static FormatErrors(diagnostics: readonly BuildDiagnostic[]): string
    {
        return diagnostics
            .filter(d => d.severity === Severity.Error)
            .map(d => d.message)
            .join(BuildService.DiagnosticSeparator);
    }
}
```

Note: `ServiceKey` must be imported (from `@pragmatic-tech-ai/mural/runtime` — allowed — matching how `SolutionManagerService.Key`/`PackageStoreKey`/`BuildSystemRegistryKey` are declared). Verify the exact relative paths for `build-system-registry-key.js`, `package-store.js`, `solution-manager-service.js`, `local-npm-registry.js`, `manifest.js`, `project-factory.js` against the recon (they are: composition/, todl-build-system/, solution-manager/engine/, package-manager/registries/npm/, package-manager/, project-services/core/). Adjust any path the compiler rejects; do not change the logic.

- [ ] **Step 4: Export from the main barrel**

In `src/index.ts`, add near the build-system exports:
```ts
export { BuildService, type PublishOutcome } from './solution-services/todl-build-system/build-service.js';
export { InMemoryBuildStorage } from './solution-services/todl-build-system/in-memory-build-storage.js';
export { ScopeFlatteningStorage } from './solution-services/todl-build-system/scope-flattening-storage.js';
```

- [ ] **Step 5: Run the test + typecheck + browser-safe check**

Run: `npx tsx --conditions=development --test src/solution-services/todl-build-system/tests/build-service.test.ts` — Expected: PASS (all three assertions). Then `npx tsc --noEmit` — Expected: 0 errors. Then run the browser-safe guard `npx tsx --conditions=development --test src/solution-services/project-services/composition/tests/browser-safe-composition.test.ts` and compare to the pinned baseline — the `BuildService` export must not make it WORSE (if it was already red at baseline, it must be no redder; if green, it must stay green).

- [ ] **Step 6: Commit**

```bash
git add src/solution-services/todl-build-system/build-service.ts src/solution-services/todl-build-system/in-memory-build-storage.ts src/solution-services/todl-build-system/scope-flattening-storage.ts src/solution-services/todl-build-system/tests/build-service.test.ts src/index.ts
git commit -m "feat(todl): engine-pure BuildService for build/publish (relocated from plexus-core PackagePublisher)"
```
(+ attribution trailer.)

---

### Task 5: Broaden the engine boundary guard to all of `solution-services`

**Files:**
- Modify: `src/solution-services/solution-manager/engine/tests/engine-boundary.test.ts`

**Interfaces:**
- Produces: a test that fails if ANY `.ts` under `src/solution-services/` imports `@pragmatic-tech-ai/mural/framework`. After Tasks 1–4 the offender set is empty.

- [ ] **Step 1: Rewrite the guard to scan all of solution-services recursively**

Replace the narrow engine-only scan with a recursive walk of `src/solution-services/**/*.ts` (resolve the solution-services root relative to this test file), reading each file and collecting any whose text contains the substring `@pragmatic-tech-ai/mural/framework`. Keep an explicit (now EMPTY) `ALLOWLIST` constant with a comment explaining the bootstrapper exception is about `mural/compiler`/`mural/runtime`, which this check does not flag. Remove the old `setting-bag-definition.ts` allowlist entry. Assert `deepEqual(offenders, [])` with a message listing any offenders. Keep it in the same file/location so it runs with the suite.

- [ ] **Step 2: Run it to verify it now passes (and would catch a regression)**

Run: `npx tsx --conditions=development --test src/solution-services/solution-manager/engine/tests/engine-boundary.test.ts`
Expected: PASS (zero offenders, because Tasks 1–4 removed every `mural/framework` import from `solution-services`). To prove it is not vacuous, temporarily add a `// @pragmatic-tech-ai/mural/framework` comment to any solution-services `.ts`, re-run, confirm it FAILS listing that file, then remove the comment and confirm PASS again.

- [ ] **Step 3: Commit**

```bash
git add src/solution-services/solution-manager/engine/tests/engine-boundary.test.ts
git commit -m "test(todl): boundary guard forbids mural/framework across all of solution-services"
```
(+ attribution trailer.)

---

## Done when

All five tasks complete; `npx tsc --noEmit` clean; the full `npm test` (after `gen:prelude`/`gen:scaffold`/`compile:mu`) shows NO new failures beyond the ledger's pinned pre-existing baseline set, and the files touched by this wave are green; the boundary guard passes. Then finishing-a-development-branch (merge to main) and a minor todl publish (0.38.9 → 0.39.0) for the C2 chain — human-gated (pre-authorized this session). Plexus is NOT touched this wave; it adopts the new todl in Wave 4.
