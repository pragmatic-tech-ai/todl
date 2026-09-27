# Wave 3a — Solution open-projects + resolver editor surface (TODL)

**Status:** design / spec
**Date:** 2026-09-27
**Ships as:** `@pragmatic-tech-ai/todl@0.38.0`

## Context

Wave 3 makes Plexus's `ProjectExplorerService` a projection of the TODL
`SolutionManagerService` (an ambient solution whose members are the open
projects), retires the Plexus-side `WorkspaceBaseResolver`, and drives editor
base-refresh from `SolutionBaseResolver.StaleMemberIds`. It is decomposed into
three sub-waves built one at a time:

- **W3a (this spec, TODL):** the TODL primitives Plexus will adopt — per-project
  open/close over an ambient solution, and the editor-facing resolution surface
  folded onto `SolutionBaseResolver`. Ships as 0.38.0.
- **W3b (Plexus):** `ProjectExplorerService` derives `OpenProjects` from
  `ActiveSolution.Members`; `WorkspaceBaseResolver` retires; capability seams
  rebind to `SolutionBaseResolver`.
- **W3c (Plexus):** the language client subscribes to `StaleMemberIds` and
  coalesces base-refreshes; the imperative `RefreshDependentsOfIds` propagation
  retires.

This spec covers **W3a only**. It adds no host coupling: everything below reads
`IStorage` + manifests and delegates published lookups to the existing
`PackageStoreKey` inner source. Both components are unit-testable in TODL with
the existing fakes.

Prior art this builds on (all now on TODL `main` @ v0.37.0):
- `SolutionManagerService` / `Solution` / `SolutionMember`
  (`src/solution-services/solution-manager/engine/`).
- `SolutionBaseResolver` (same folder) — the live-first `IPackageSource` with
  `TryGet`, `Invalidate`, `StaleMemberIds`, a per-member compile cache and a
  `baseIdsOf` forward graph.
- `WikiLocator` / `WikiOrigin`
  (`src/solution-services/project-services/core/wiki-origin.ts`).
- `ProjectModelProvider`
  (`src/solution-services/project-services/generators/project-model-provider.ts`)
  — `Compile()`, `ResolveBases()`, `CompileWithBases(bases)` → `ProjectModel { package?, errors }`.

The Plexus source of truth being ported is
`apps/plexus/src/renderer/src/services/projects/workspace-base-resolver.ts`
(319 lines). W3a reproduces its behavior on solution members and TODL
primitives; W3b then deletes it.

## Global Constraints

- **OOP, no free functions / module state.** Every function is a method (or a
  `private static` on the class it belongs to). The one existing module-level
  helper being ported (`tagOrigin`) becomes a `private static` method.
- **Allman braces** throughout (opening brace on its own line for class /
  method / control-flow blocks; object literals and arrow bodies stay inline).
- **No inline string literals.** Hoist reused literals and message templates to
  `private static readonly` PascalCase constants; structural single-use tokens
  (path separators, `typeof` guards) may stay inline.
- **PascalCase** for all public methods and interfaces. The port fixes the
  current camelCase `referencedPublishedRefs` → `ReferencedPublishedRefs`.
- **Services extend `ServiceBase`** (todl-runtime); notifications via
  `RaisePropertyChanged`. No new dependency-property use.
- **Host-free.** No import from `mural`, Plexus, Electron, or node builtins.
  Published lookups go through `inner()` (`PackageStoreKey`), never a Plexus
  `ensurePackagesBackend` or direct `model.json` reads.
- **Tests live in a `tests/` subfolder** next to the source.
- **Version bump to 0.38.0** and publish are part of execution (norms-gated;
  authorized as the W3a deliverable), reusing the v0.37.0 publish mechanics
  (`--userconfig <TODL main>/.npmrc`, `$PACKAGES_TOKEN`).

## Review Focus

Inputs the components will meet that no single happy-path test exercises, most
likely to bite first:

1. **`OpenProject` on the same location twice** — must dedupe (return the
   existing member), not add a duplicate member or reopen. (Task 2.)
2. **`OpenProject` when a titled `.pksln` solution is active** — the member path
   must resolve under the solution root (relative), and the solution *is*
   dirtied; only an untitled/ambient solution stays non-dirty. (Task 2.)
3. **A binding whose producer is open but its live compile fails** —
   `ResolveBasesFor` must surface the producer's compile errors as `problems`
   and still fall through to the published copy for the base doc, not silently
   drop the base. (Task 5.)
4. **A diamond vs a genuine cycle** — the same producer reached by two
   independent branches resolves once without a cycle diagnostic; a producer
   that transitively binds itself yields exactly one "cyclic local reference"
   problem and falls back to published. (Task 5.)
5. **A binding ref whose published `model.json` is absent** (unpublished local
   producer, no open member) — `ResolveBasesFor` emits one "not published"
   problem; `ReferencedPublishedRefs` still records that ref's own
   `id@version` key and stops (its transitive deps are unreachable). (Tasks 5, 6.)

---

## Component 1 — `SolutionManagerService`: ambient solution + per-project open/close

**Files:**
- Modify: `src/solution-services/solution-manager/engine/solution-manager-service.ts`
- Modify: `src/solution-services/solution-manager/engine/solution.ts`
- Tests: `src/solution-services/solution-manager/engine/tests/open-project.test.ts` (new),
  and additions to the existing `tests/open-members.test.ts`.

### Behavior

Today members only arrive via `OpenSolution` (parse `.pksln` → `AddMember` per
manifest member → `OpenMembers` opens them all). W3a adds the loose-project
primitives so a host can open/close one project at a time into whatever solution
is active — creating an ambient untitled solution on demand when none is.

**`private EnsureActiveSolution(): Solution`**
- Returns `this.ActiveSolution` if defined.
- Else creates `new Solution(SolutionManagerService.UntitledName)` (no location),
  activates it via `setActive`, and returns it. No `canReplace` prompt — there is
  nothing to replace. Does not touch `lastSolution`/recents (an ambient solution
  is not a remembered solution).

**`public async OpenProject(location: string): Promise<SolutionMember>`**
- `const solution = this.EnsureActiveSolution()`.
- **Dedupe:** if a member already has `Ref.path === memberPath` (see path rule),
  return it unchanged (no reopen).
- Resolve the member's storage: `const storage = this.storages.CreateStorage(location)`.
- Read the project manifest for its `type`:
  `const manifest = parseManifest(await storage.ReadText(PROJECT_MANIFEST_FILENAME))`.
- **Path rule:** for a solution with a location (titled), the member path is
  `location` made relative to `solution.Storage.Root` when it is under it,
  otherwise `location` as-is; for an untitled/ambient solution (no location) the
  member path is the absolute `location`. (A dedicated `private memberPathFor(solution, location)`.)
- `const member = solution.AddMember(memberPath, manifest.type)`.
- Open just that member:
  `await solution.OpenOne(member, (rel) => this.memberStorageFor(solution, rel), (type) => this.factories.factoryFor(type))`.
- **Dirty rule:** if `!solution.HasLocation` set `solution.IsDirty = false` after
  the add+open (a loose project added to an ambient solution is not unsaved
  solution content — so a later `OpenSolution` won't prompt to discard). A titled
  solution stays dirty (its manifest membership changed).
- Return `member`.

**`public async CloseProject(member: SolutionMember): Promise<void>`**
- If there is no `ActiveSolution`, or `member` is not one of its members, no-op.
- Dispose the member's opened project if it is disposable
  (`(member.Project as { dispose?: () => void }).dispose?.()`), duck-typed —
  `Project` is `unknown`.
- `solution.RemoveMember(member)`.
- **Dirty rule:** same as `OpenProject` — untitled stays non-dirty, titled dirties.

**`private memberStorageFor(solution, memberPath): IStorage`**
- Titled: `this.storages.CreateStorage(SolutionManagerService.joinPosix(solution.Storage.Root, memberPath))`.
- Untitled: `this.storages.CreateStorage(memberPath)` (the path is absolute).

### `Solution.OpenOne`

Refactor the body of `Solution.OpenMembers`'s per-member loop into:

**`public async OpenOne(member: SolutionMember, storageFor: MemberStorageResolver, factoryFor: ProjectFactoryResolver): Promise<void>`**
- Resolve `factory = factoryFor(member.Ref.type)`; if none, leave the member
  unresolved (`Storage`/`Project` undefined), no throw — unchanged behavior.
- Else `const storage = storageFor(member.Ref.path)`; `member.Storage = storage`;
  `member.Project = await factory.openProject(storage)`.

`OpenMembers` then becomes `for (const m of this.Members) await this.OpenOne(m, storageFor, factoryFor)` — a pure extraction, so the existing `open-members.test.ts` must stay green unchanged.

### New constants / types

- No new user-facing strings. `UntitledName` already exists.
- `memberPathFor` uses the existing `joinPosix`; a leading-slash / under-root
  check is structural (inline path logic is allowed).

---

## Component 2 — `SolutionBaseResolver`: editor-facing resolution surface

**Files:**
- Modify: `src/solution-services/solution-manager/engine/solution-base-resolver.ts`
- Tests: additions to `src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`.

Four public methods join `TryGet` / `Invalidate` / `StaleMemberIds` on the one
resolver. They read the same `ActiveSolution.Members`, the same `inner()`
(`PackageStoreKey`) published source, and `WikiLocator` for origins — no new
collaborators.

### `ResolveBasesFor`

**`public async ResolveBasesFor(consumerStorage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[]; originOf: ReadonlyMap<string, WikiOrigin> }>`**

A faithful port of `WorkspaceBaseResolver.resolveBindingsOf` → `resolveOne` →
`resolvePublishedTransitive`, retargeted to solution members and TODL primitives.

- Read the consumer manifest via `parseManifest`.
- Walk `manifest.metaModels` then `manifest.libraries`; for each ref call a
  private recursive `resolveOne(ref, kind, consumerStorage, path, seenPub, bases, problems, originOf)`.
- `resolveOne`:
  - `producer = await this.liveProducerFor(ref.id)` **filtered to `kind`** (a
    member qualifies only when `manifest.type === kind`).
  - **Live branch** — producer exists, its storage is not the consumer, and not
    already on the DFS `path` (a `Set<IStorage>`):
    - add producer storage to `path`; recurse the producer's own bindings into a
      child `{ bases, problems }`; remove from `path` (backtrack).
    - `model = await new ProjectModelProvider(producerStorage, producerManifest, this).CompileWithBases(childBases)`.
    - push `model.package.document` into `bases` when present; map each
      `model.errors` message to a `problems` entry
      `` `local ${kind} "${ref.id}" — ${e}` ``.
    - if `model.package === undefined`, additionally resolve the **published**
      copy so the base doc is not lost (Review Focus #3).
    - version-mismatch diagnostic: when the producer manifest `packageVersion`
      is defined and `!== ref.version`, push
      `` `using local "${ref.id}" (open project) — binding requests @${ref.version}, project is @${producerVersion}` ``.
    - tag origin: `this.tagOrigin(originOf, doc, WikiLocator.OpenProjectOrigin(producerStorage))`.
  - **Cycle branch** — producer exists but its storage is already on `path`: push
    `` `cyclic local reference to "${ref.id}"; using published` `` and fall through
    to published.
  - **Published branch** (`resolvePublishedTransitive`): dedupe on
    `` `${kind}:${ref.id}@${ref.version}` `` in `seenPub`; `sourced = await this.inner().TryGet(ref)`;
    if defined push `{ nodes: sourced.Document.nodes, edges: sourced.Document.edges }`,
    tag `WikiLocator.PackageOrigin(ref.id, ref.version)`, and recurse each
    `sourced.Dependencies` (kind from `dep.kind`); if undefined push
    `` `${kind} "${ref.id}@${ref.version}" is not published` ``.
- `private static tagOrigin(originOf, doc, origin)` — first-writer-wins per node
  id (a node reached first by a live-producer binding keeps that origin over a
  later published-diamond reach).

`inner()` returns `SourcedPackage { Document: TodlDocument; Dependencies: readonly PackageRef[] }`,
so the published branch needs no `model.json` parsing.

### `ReferencedPublishedRefs`

**`public async ReferencedPublishedRefs(consumerStorage: IStorage): Promise<Set<string>>`**

Published-only transitive set of `` `${id}@${version}` `` keys (used by the
toolbox scoping in Plexus). Port of `referencedPublishedRefs` / `collectPublishedRef`:
- read consumer manifest; for each `metaModels` + `libraries` ref call
  `private async collectPublishedRef(ref, out)`.
- `collectPublishedRef`: key = `` `${ref.id}@${ref.version}` ``; if `out` has it
  return; add it; `sourced = await this.inner().TryGet(ref)`; on a hit recurse
  `sourced.Dependencies`; on a miss stop (own key already recorded — Review Focus #5).
- Does **not** consult open members — this is deliberately the published closure.

### `WorkspaceProducers`

**`public async WorkspaceProducers(kind: ProjectType): Promise<readonly DependencyRef[]>`**

Every open, resolved member producing a base of `kind`, as `{ id, version }`
(`DependencyRef`), for the References-manager catalog:
- iterate `this.Provider.get(SolutionManagerService.Key)?.ActiveSolution?.Members ?? []`;
  for each with a defined `Storage`, parse its manifest; include when
  `manifest.type === kind` and `manifest.id`/`packageVersion` are defined; skip a
  producer with no version (a reference needs a concrete version to record).

### `ProducedIdOf`

**`public async ProducedIdOf(consumerStorage: IStorage): Promise<string | undefined>`**

The producer id a storage's manifest declares: parse manifest; return
`manifest.id` when `type` is `MetaModel` or `Library`, else `undefined`.

### Not ported (W3c owns them)

`DependentsOf` and `RefreshDependentsOfIds` are the imperative propagation W3c
replaces with the `StaleMemberIds` push. They are **not** added here. The
`baseIdsOf` forward graph and `Invalidate`/`StaleMemberIds` already present are
untouched.

---

## Barrel exports

`src/index.ts` already exports `SolutionManagerService`, `SolutionBaseResolver`,
`SolutionMember`, `Solution`, `WikiLocator`/`WikiOrigin`, `ProjectType`,
`parseManifest`, and `ProjectModelProvider`. W3a adds no new exported symbols —
only new methods on already-exported classes — plus `DependencyRef` if it is not
already barrel-exported (confirm during Task 1; export it if missing, since
`WorkspaceProducers`'s return type must be importable by Plexus in W3b).

## Testing strategy

TODL vitest, tests in the `tests/` subfolders, using the existing fakes
(`fake` storage registry / project-factory registry / package source in
`solution-manager/engine/tests/` and `todl-build-system/tests/fakes.ts`).

Component 1:
- ambient auto-create: `OpenProject` with no active solution creates an untitled
  solution and adds the member;
- dedupe: opening the same location twice yields one member (Review Focus #1);
- dirty rule: untitled stays `IsDirty === false` after open/close; a titled
  solution dirties (Review Focus #2);
- `OpenOne` parity: `open-members.test.ts` stays green after the extraction;
- `CloseProject` removes the member and disposes a disposable project.

Component 2:
- live-over-published: an open producer member's live compile is preferred; its
  nodes carry an `OpenProject` origin;
- published closure: transitive deps resolved via `inner().TryGet`, `Package`
  origins, deduped;
- diamond vs cycle (Review Focus #4);
- failed live compile still yields the base + surfaces problems (Review Focus #3);
- not-published diagnostic + `ReferencedPublishedRefs` own-key-then-stop
  (Review Focus #5);
- `WorkspaceProducers` filters by kind and skips versionless producers;
- `ProducedIdOf` returns the id for producers, `undefined` otherwise.

## Out of scope (later sub-waves)

- Any Plexus change (W3b/W3c).
- Incremental graph patching / caching of `ResolveBasesFor` results (the language
  client caches per-storage; parity with today).
- Persistence/session-restore unification (stays in Plexus; W3b calls
  `OpenProject` per persisted path).
