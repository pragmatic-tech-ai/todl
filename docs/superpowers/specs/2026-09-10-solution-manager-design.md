# [TODL] Solution concept + SolutionManager — design spec

## Summary

Introduce a **Solution**: a logical grouping of several projects plus a holder for
cross-project settings. It is a persisted on-disk artifact (`solution.json`) and an
in-memory session. A **SolutionManager** owns exactly **one active solution at a time**
(the Visual Studio `.sln` model): it can create a new empty solution, open/save/close
one, and maintain a recent-solutions list. Opening a solution **opens all its member
projects at once** into a Solution Explorer. Cross-project settings (e.g. the NPM
registry configuration) are modeled as named **setting bags** contributed by the host,
edited through the existing `PropertyGrid`, and persisted in the manifest.

The whole feature is implemented in the **`@pragmatic-tech-ai/todl`** package (which
declares a Mural module), sits on the relocated IO subsystem in
**`@pragmatic-tech-ai/todl-runtime`**, and is referenced by the **TODL host app**'s
`app.mu`. **Mural gains nothing.**

## Layering (fixed)

```
todl-runtime (@pragmatic-tech-ai/todl-runtime, zero-dep)
  └─ ONLY the relocated IO subsystem: IStorage, StorageEntry, ILocalFileAccess,
     isLocalFileAccess, compareStorageEntries, FakeStorage, copy-tree.
mural (@pragmatic-tech-ai/mural)   [depends on todl-runtime]
  └─ NOTHING added. Existing framework only (ServiceBase, module/Capability,
     ProjectFactoryRegistry, SettingDefinition/SettingKind, ObservableCollection,
     PropertyGrid). Consumes IStorage from todl-runtime; re-exports it.
todl (@pragmatic-tech-ai/todl)     [depends on mural + todl-runtime]
  └─ Implements ALL of it: SolutionManagerService, SolutionSession, SolutionManifest,
     SolutionMember, SettingBagDefinition, SolutionSettingsRegistry, the PropertyGrid
     adapter, and DECLARES the mural module (solution-manager.module.mu). Generic over
     ProjectFactoryRegistry; tested with a FakeProjectFactory.
TODL host app (TODL/app)           [depends on todl]
  └─ app.mu references SolutionModule; registers a real `todl-package` ProjectFactory;
     registers LocalFileStorage ('local'); contributes the npm-registry setting bag.
```

**Consciously accepted:** this makes `@pragmatic-tech-ai/todl` depend on
`@pragmatic-tech-ai/mural`, reversing the prior "TODL stands alone" rule. It is
**acyclic** — Mural depends only on `todl-runtime`, never on `@pragmatic-tech-ai/todl`.

## Decisions (locked with the user)

1. **Session model:** one active solution at a time. `ActiveSolution` + recent list;
   New/Open replaces the current solution (dirty → save prompt).
2. **Storage:** relocate the IO subsystem from Plexus into `todl-runtime` (shared,
   zero-dep). Concrete `LocalFileStorage` + `StorageProviderRegistry` stay host-side.
3. **Project role:** opening a solution opens **all** member projects (multi-project
   Solution Explorer), not the previous one-active-project flow.
4. **Project layout:** relative references, projects anywhere. Manifest stores
   `{ path (relpath, POSIX), type }`; members may live beside or outside the solution
   folder and be shared across solutions.
5. **Settings:** named setting **bags** declared/contributed **imperatively** by the
   host (reusing `ApplicationSettings.Contribute` precedent — no new Mural module
   block). Each bag = a group of `SettingDefinition`s; values persist in the manifest;
   edited via `PropertyGrid`.
6. **Scope:** the `todl` package ships **generic** machinery (tested with a
   `FakeProjectFactory`); the real `todl-package` project factory is created in the
   **TODL host app**.

## Section 1 — Storage relocation (`todl-runtime`)

**Moves down (all node-free):** `storage.ts` (`IStorage`, `StorageEntry`,
`ILocalFileAccess`, `isLocalFileAccess`, `compareStorageEntries`), `fake-storage.ts`
(`FakeStorage`), `copy-tree.ts`. `todl-runtime/src/index.ts` re-exports them from a
`storage/` subfolder; still zero-dep.

**Stays host-side:** `LocalFileStorage` (Electron `FileSystemService` glue),
`StorageProviderRegistry` (a Mural `ServiceBase` that knows `FileSystemService`),
`storage-package-sink.ts` (imports `PackageSink` from `@pragmatic-tech-ai/todl`; lands
in the `todl` package).

**Import re-pointing:** ~40+ Plexus files change
`from '.../services/storage/storage.js'` → `from '@pragmatic-tech-ai/todl-runtime'`
(mechanical). Mural re-exports the storage types so `@pragmatic-tech-ai/mural/runtime`
consumers need no second import path; canonical source is `todl-runtime`.

## Section 2 — SolutionManagerService + SolutionSession (`todl` package)

```
class SolutionManagerService extends ServiceBase implements IActivatable {
  static readonly Key = new ServiceKey<SolutionManagerService>('SolutionManager')
  ActiveSolutionKey  : SolutionSession | undefined
  RecentSolutionsKey : ObservableCollection<RecentSolutionRef>   // persisted via ApplicationSettings
  // HeaderCommands (ServiceBase) → New / Open / Save toolbar

  NewSolution(): Promise<void>                  // close-current (dirty prompt) → empty session
  OpenSolution(location: string): Promise<void> // resolve IStorage, read manifest, open ALL members
  Save(): Promise<void>                         // write manifest through session.Storage
  SaveAs(location: string): Promise<void>       // re-root + write + update recent
  CloseSolution(): Promise<void>                // dirty prompt → dispose members → Active = undefined
}

class SolutionSession extends Observable {
  Name        : string
  Storage     : IStorage                        // rooted at the solution folder
  Members     : ObservableCollection<SolutionMember>
  SettingBags : ObservableCollection<SolutionSettingBag>
  IsDirty     : boolean                         // member add/remove or setting edit flips it
  AddMember(relpath, typeId) / RemoveMember(m)
}

class SolutionMember extends Observable {
  Ref     : { relpath: string, typeId: string } // what the manifest stores
  Project : unknown | undefined                 // opened project handle (open-all); undefined = unresolved
  Title   : string                              // display; comes from the opened project, not the manifest
}
```

- Replacing the active solution routes through a dirty-check → existing
  `DialogService`/`ConfirmDialog` save prompt (Mural framework; available since `todl`
  depends on Mural).
- **Open-all flow (per member):** resolve `member.relpath` against the solution folder
  → absolute location → `StorageProviderRegistry.Create('local', abs)` → `IStorage`;
  `ProjectFactoryRegistry.GetByType(typeId).Factory` → `openProject(storage)` →
  `member.Project`. Unknown `typeId` ⇒ member stays listed as **unresolved** (no crash).
- **Recent list** persists as a `string[]`-valued setting through the existing
  `ApplicationSettings` seam — no new persistence machinery.
- Defaults: solution file is `solution.json` at the chosen folder (folder-as-home,
  members may still be `../`); dirty tracking is coarse (any member/setting mutation
  flips `IsDirty`; Save clears it).

## Section 3 — Manifest schema + serialization

`solution.json`:

```json
{
  "kind": "todl-solution",
  "version": 1,
  "name": "My Solution",
  "members": [
    { "path": "./api",         "type": "architecture" },
    { "path": "../shared-lib", "type": "library" }
  ],
  "settings": {
    "npm-registry": { "registry": "https://...", "scope": "@acme", "org": "acme",
                      "tokenSource": "env", "tokenEnvVar": "NPM_TOKEN" }
  }
}
```

`SolutionManifest` (a class in `todl`, mirroring the existing `parseManifest`
convention — `JSON.parse` + shape validation, not a schema lib):
- `parse(text): SolutionManifest` — validates `kind`/`version`; coerces
  `members`/`settings`; throws a clear error on malformed/wrong-`kind`.
- `stringify(session): string` — `JSON.stringify(…, 2)`.

Rules:
- **Paths** stored POSIX (`/`, `./`, `../`), resolved against the solution folder at
  open; Save normalizes to POSIX (OS-stable).
- **Settings carry primitives only** (string/number/bool) — the same lowering
  `ApplicationSettings.toStorable` uses; raised back to typed `Setting`s via the bag
  schema on load.
- **Unknown member `type` and unknown setting bags are preserved** on round-trip (never
  silently dropped when a build lacks the owning module). Broken members surface as
  unresolved in the explorer.
- **`version: 1`**; a higher major is rejected ("made by a newer version"), not
  mis-parsed.
- Only **touched** bags are written; untouched bags are absent and fall back to schema
  defaults on load. Member array order = explorer display order (persisted by position).

## Section 4 — Multi-project session + Solution Explorer

Net-new UI in the `todl` package (surfaced through the `Solutions` `Capability` side
pane). NOT a refactor of Plexus's project-explorer (Plexus stays as-is; may adopt
later).

```
Solution "My Solution"           ← ActiveSolution.Name
├─ api        (architecture)     ← SolutionMember (opened project) + folder tree (IStorage.List)
├─ web        (architecture)
└─ shared-lib (library)  ⚠ unresolved
```

- `SolutionTreeVM` binds `ItemsSource = $ActiveSolution.Members`; each member expands to
  its structure via the member's rooted `IStorage.List` (the read-only folder-tree
  pattern already used on the compiler page — `FolderNodeVM`). Members open together on
  solution load.
- **Commands:** *Add Existing Project…* (pick folder → detect manifest `type` → append
  `{relpath, type}`), *New Project…* (picker over `ProjectFactoryRegistry.Definitions`
  → `createProject` into a subfolder → add), *Remove* (drop ref; never deletes files),
  *Open/Reveal member*. Add/remove flip `IsDirty`.
- **Unresolved members** render with a ⚠ affordance and are preserved in the manifest.

**Prerequisite:** "open all members" is only meaningful when the host has registered
project types via `ProjectFactoryRegistry`. The `todl` package is generic over
whatever factories exist and is tested with a `FakeProjectFactory`. The TODL host app
creates the real **`todl-package`** project factory (wrapping the existing
folder→compile→publish flow as a project type) and registers it.

## Section 5 — Cross-project setting bags

Contributed **imperatively** (reusing the `ApplicationSettings.Contribute` precedent —
no new Mural module block, Mural untouched).

```
class SettingBagDefinition {        // a named group of typed fields
  Id: string                        // "npm-registry"  (manifest key + registry key)
  Title: string                     // "NPM Registry"
  Fields: SettingDefinition[]       // REUSES Mural's SettingDefinition + SettingKind
}
class SolutionSettingsRegistry extends ServiceBase {   // aggregates bag DEFINITIONS
  static Key
  Contribute(bag: SettingBagDefinition): void          // idempotent by Id
  Definitions: ObservableCollection<SettingBagDefinition>
}
```

- **Schema** registered imperatively (a contributor resolves `SolutionSettingsRegistry`
  and calls `Contribute`). The TODL app contributes its `npm-registry` bag this way
  (registry / scope / org / tokenSource / tokenEnvVar as `SettingDefinition`s).
- **Values** live on `SolutionSession` keyed by `bagId` (`Record<key, primitive>`),
  persisted in the manifest `settings`; untouched bags fall back to field defaults.
- **Editing via PropertyGrid:** an adapter maps each bag's `SettingDefinition[]` →
  `GridProperty[]` (`SettingKind` → `PropertyKind`) and wraps the session's `bagId`
  values in a `MapPropertyBag`. The pane is
  `PropertyGrid [ Descriptors = <bag fields>, Target = <MapPropertyBag over values> ]`,
  one category per bag. Edits write through → flip `IsDirty` → saved with the solution.

## Section 6 — The mural module (declared in `todl`)

```
module SolutionModule [ Name = "Solutions" ] {
    .services: { SolutionManagerService, SolutionSettingsRegistry }
    Capability [ Name = "Solutions", Icon = @Solutions, ServiceKey = SolutionManagerService ]
}
```

Referenced by the TODL host app's `app.mu` (added to its `.modules:` block). Markup-
facing controls/VMs (`SolutionTreeVM`, `SolutionMember`, `SolutionSettingBag`, and the
`Solutions` capability) are registered in the compiler symbol-table and their templates
merged, following the PropertyGrid reference pattern.

## Testing

TDD; tests in `tests/` subfolders.
- **`todl-runtime` storage:** move existing `FakeStorage`/`compare-storage-entries`/
  `copy-tree` tests down; they are the move's regression net.
- **`todl` solution machinery** (against `FakeStorage` + `FakeProjectFactory`, no
  Electron): `SolutionManager` lifecycle (New/Open/Save/SaveAs/Close + dirty prompt);
  `SolutionManifest` round-trip (parse↔stringify, unknown-type/bag preserved,
  wrong-`kind`/future-`version` rejected, POSIX normalization); open-all resolution
  (resolved vs unresolved); setting bags (Contribute idempotent, values persist,
  untouched→defaults); PropertyGrid adapter (`SettingKind→PropertyKind`, `MapPropertyBag`
  write-back flips `IsDirty`).
- **TODL app:** real `todl-package` `ProjectFactory` (create/open/save); module-wiring
  smoke (app.mu resolves `SolutionManagerService`); optional Playwright e2e
  (New → Add member → Save → reopen).

## Cross-repo sequencing (bottom-up; green build+tests at each hop)

1. `todl-runtime`: add storage subsystem, bump, build/test.
2. `mural`: pick up new `todl-runtime`, re-export storage; build/test (no feature code).
3. `Plexus` + `todl`: re-point storage imports, delete old copies; build/test (Plexus
   only re-points — does NOT adopt solutions).
4. `todl`: implement solution machinery + `SolutionModule`; build/test with fakes.
5. TODL app: real `todl-package` factory, wire `SolutionModule` into `app.mu`, register
   `LocalFileStorage`, contribute `npm-registry` bag; build/test/e2e.

Republish gotchas to watch: bump versions, clear npm cache, don't let `sed` touch
lockfiles. Phases 1–3 ship independent value (shared storage) before any solution code.

## Non-goals (v1)

- Multiple concurrent solutions; per-member independent open/close (open-all only);
  nested solutions.
- Solution-level build/run/orchestration across members; inter-member dependency graph.
- Plexus migration to solutions (separate, later).
- Remote/cloud storage backend (interface allows it; no impl ships).
- **Security constraint:** the manifest NEVER stores a literal registry token — only
  `tokenSource`/`tokenEnvVar`. `solution.json` is shareable/committable; secrets stay in
  the app's existing `TokenStore`/env. The `npm-registry` bag schema has no token-literal
  field.
