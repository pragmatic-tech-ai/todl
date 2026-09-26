# SolutionBaseResolver + generator base-resolution (Wave 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let TODL's content generators resolve base models from the open solution's live member sources, not just published packages, by adding a `SolutionBaseResolver` (`IPackageSource`) and wiring the composer's generator context to it.

**Architecture:** `SolutionBaseResolver` is a TODL `IPackageSource` that layers live compiles of open, resolved `SolutionManagerService` producer members over an inner published source (`PackageStoreKey`). It compiles a matched member live through `ProjectModelProvider` (recursive, cycle-guarded), caches per member, and raises a `StaleMembers` signal on invalidation. `ProjectSystemComposer.ResolveSource` prefers it when a `SolutionManagerService` is registered. `SolutionMember` retains its `IStorage` (set in `Solution.OpenMembers`) so the resolver can compile it.

**Tech Stack:** TypeScript (ESM, strict), `@pragmatic-tech-ai/todl-runtime` DI (`ServiceBase`/`ServiceKey`/`IServiceProvider`/`Observable`/`IStorage`), node:test + tsx.

**Spec:** docs/superpowers/specs/2026-09-27-solution-base-resolver-design.md

## Global Constraints

- OOP only: no free functions or module-level mutable state; behavior on classes (static or instance methods). Module-level `const` for true constants/tokens is fine. (Note: the existing `parseManifest` free function in `package-manager/manifest.ts` is pre-existing and reused as-is; do not add new free functions.)
- Allman braces everywhere (opening brace on its own line) for classes/interfaces/methods/control-flow; object literals and arrow bodies stay inline.
- No inline string literals: hoist messages/keys/filenames to `private static readonly` PascalCase constants. Reuse the existing `PROJECT_MANIFEST_FILENAME` constant for the manifest filename.
- Interfaces and new public methods are PascalCase. Existing camelCase members of `IProjectFactory` stay as-is.
- Enums, never string-literal unions. View models extend `Observable`.
- Every test file lives in a `tests/` subfolder next to its source.
- TODL depends on `@pragmatic-tech-ai/mural` but on no host application. `SolutionBaseResolver` imports only from `todl-runtime` + TODL-internal modules.
- Commit attribution: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Review Focus

- **A member with no registered factory (`Storage`/`Project` undefined):** the resolver must skip it (never call `.Compile()` on an unresolved member) and fall through to the published source — pinned in Task 3.
- **Live compile failure with no published fallback:** `TryGet` returns `undefined` (not a throw), so the recursive resolver records an unresolved base rather than crashing generation — pinned in Task 3.
- **A→B→A member binding cycle:** resolution terminates (the re-entered member yields no further live compile), no stack overflow — pinned in Task 3.
- **No `SolutionManagerService` registered (headless/CLI/smoke):** the composer falls back to `PackageStoreKey`/empty exactly as today; no generator behavior change — pinned in Task 4.
- **A non-producer member (architecture) whose id collides with a binding:** the resolver only live-compiles `MetaModel`/`Library` members, so an architecture member never shadows a published base — pinned in Task 3.

---

## File Structure

New (TODL, under the worktree `src/`):
- `solution-services/solution-manager/engine/solution-base-resolver.ts` — `SolutionBaseResolver` (`IPackageSource`) + `SolutionBaseResolver.Key`.
- `solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts` — unit tests.

Modified (TODL):
- `solution-services/solution-manager/engine/solution-member.ts` — add `Storage`.
- `solution-services/solution-manager/engine/solution.ts` — set `member.Storage` in `OpenMembers`.
- `solution-services/solution-manager/engine/solution-manager-service.ts` — expose the member set the resolver reads (already `Members`; add nothing unless a read accessor is missing).
- `solution-services/project-services/composition/project-system-composer.ts` — `ResolveSource` prefers `SolutionBaseResolver` when `SolutionManagerService` is registered.
- `solution-services/project-services/composition/tests/project-system-composer.test.ts` — composer wiring test.
- `src/index.ts` — export `SolutionBaseResolver` + `SolutionBaseResolver.Key` on the main barrel (browser-safe: it imports only todl-runtime + TODL internals).

---

### Task 1: SolutionMember gains Storage; Solution.OpenMembers stashes it

**Files:**
- Modify: `src/solution-services/solution-manager/engine/solution-member.ts`
- Modify: `src/solution-services/solution-manager/engine/solution.ts` (the `OpenMembers` method)
- Test: `src/solution-services/solution-manager/engine/tests/solution-member.test.ts` (create if absent; else add a case)

**Interfaces:**
- Consumes: `IStorage` (`@pragmatic-tech-ai/todl-runtime`), `MemberStorageResolver`/`ProjectFactoryResolver` (`./project-factory.js`).
- Produces: `SolutionMember.Storage: IStorage | undefined` (public, settable); after `Solution.OpenMembers`, a resolved member has `Storage` set to the same rooted `IStorage` passed to `factory.openProject`.

- [ ] **Step 1: Write the failing test.**

```ts
// tests/solution-member.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { SolutionMember } from '../solution-member.js'

test('a member exposes an undefined Storage until set', () =>
{
    const m = new SolutionMember({ path: 'a/project.plexus', type: 'meta-model' })
    assert.equal(m.Storage, undefined)
})
```

- [ ] **Step 2: Run it, verify it fails** (`Storage` not a property).

Run: `npx tsx --conditions=development --test src/solution-services/solution-manager/engine/tests/solution-member.test.ts`
Expected: FAIL (Storage undefined property / type error).

- [ ] **Step 3: Add `Storage` to `SolutionMember`.**

```ts
// solution-member.ts — add field + accessors alongside Project
import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
// ...
private _storage: IStorage | undefined

public get Storage(): IStorage | undefined { return this._storage }
public set Storage(v: IStorage | undefined) { this._storage = v }
```

Keep `SolutionMember extends Observable`; `Storage` is a plain settable field (infrastructure, not bound UI) so no `RaisePropertyChanged` is added.

- [ ] **Step 4: Set `Storage` in `Solution.OpenMembers`.**

In `solution.ts`, `OpenMembers` currently does, per member: resolve `factory`, then `member.Project = await factory.openProject(storageFor(member.Ref.path))`. Change it to build the storage once and stash it:

```ts
const factory = factoryFor(member.Ref.type)
if (factory === undefined)
{
    member.Project = undefined
    member.Storage = undefined
    continue
}
const storage = storageFor(member.Ref.path)
member.Storage = storage
member.Project = await factory.openProject(storage)
```

- [ ] **Step 5: Add an OpenMembers test asserting Storage is set for a resolved member and undefined for an unresolved one.**

```ts
test('OpenMembers stashes each resolved member storage; unresolved stays undefined', async () =>
{
    // Build a Solution with two members: one type with a fake factory, one without.
    // storageFor returns a distinct fake IStorage per path; factoryFor returns a
    // fake factory (openProject resolves to a dummy Project) only for the known type.
    // After OpenMembers: known member.Storage === the storageFor(path) instance and
    // member.Project defined; unknown member.Storage === undefined and Project undefined.
})
```

Fill the test body with the engine's existing fake patterns (see sibling tests in `engine/tests/`); assert the storage identity (`===`) and the unresolved-undefined case.

- [ ] **Step 6: Run the member + solution tests, verify pass. Commit.**

```bash
git add src/solution-services/solution-manager/engine/solution-member.ts src/solution-services/solution-manager/engine/solution.ts src/solution-services/solution-manager/engine/tests/
git commit -m "feat(solution): SolutionMember retains its Storage; OpenMembers stashes it"
```

---

### Task 2: SolutionBaseResolver — live-first TryGet over an inner published source

**Files:**
- Create: `src/solution-services/solution-manager/engine/solution-base-resolver.ts`
- Test: `src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`

**Interfaces:**
- Consumes: `IPackageSource`/`SourcedPackage` (`../../todl-build-system/package-source.js`), `PackageRef`/`CompiledPackage`/`PackageDocument` (`../../../publish/publish.js`), `ProjectModelProvider` (`../../project-services/generators/project-model-provider.js`), `ProjectType`/`ProjectManifest` (`../../package-manager/manifest.js`), `parseManifest` (`../../package-manager/manifest.js`), `PROJECT_MANIFEST_FILENAME` (`../../project-services/core/project-factory.js`), `SolutionManagerService` (`./solution-manager-service.js`), `PackageStoreKey` (`../../todl-build-system/package-store.js`), `ServiceBase`/`ServiceKey`/`IServiceProvider`/`IStorage` (`@pragmatic-tech-ai/todl-runtime`).
- Produces:
  - `SolutionBaseResolver.Key: ServiceKey<SolutionBaseResolver>` (`'SolutionBaseResolver'`).
  - `class SolutionBaseResolver extends ServiceBase implements IPackageSource`.
  - `public TryGet(ref: PackageRef): Promise<SourcedPackage | undefined>`.
  - `public Invalidate(memberId: string): void`.
  - `public get StaleMemberIds(): ReadonlySet<string>` (raises `PropertyChanged('StaleMemberIds', …)` on change — the Wave-3 host subscribes).

This task builds the class WITHOUT the cache/graph/signal internals of Task 3 — a plain live-first resolve delegating to the inner source, so it can be tested in isolation. Task 3 adds caching, the dependency graph, and the stale signal.

- [ ] **Step 1: Write the failing tests (live-first + published fallback + non-producer skip + unresolved skip).**

```ts
// tests/solution-base-resolver.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionBaseResolver } from '../solution-base-resolver.js'
import { SolutionManagerService } from '../solution-manager-service.js'
import { PackageStoreKey } from '../../../todl-build-system/package-store.js'
import type { SourcedPackage } from '../../../todl-build-system/package-source.js'

// Fixtures (static helpers on a test class — no free functions):
class Fixtures
{
    // A fake IStorage backed by a Map<path,string>; ReadText/WriteText/List over it.
    static Storage(files: Record<string, string>): any { /* minimal in-memory IStorage */ }

    // A fake SolutionManagerService exposing Members with { Ref:{path,type}, Storage } —
    // only the surface SolutionBaseResolver reads. Register under SolutionManagerService.Key.
    static Manager(members: { id: string; type: string; storage: any }[]): any { /* ... */ }

    // A fake inner published IPackageSource: Map<'id@version', SourcedPackage>.
    static Published(map: Record<string, SourcedPackage>): any { /* TryGet(ref) */ }

    // A meta-model member's files: project.plexus (id, type:'meta-model', packageVersion)
    // + one .todl declaring a concept, so ProjectModelProvider.Compile succeeds.
    static MetaModelFiles(id: string, version: string, concept: string): Record<string, string> { /* ... */ }
}

test('a live open producer member resolves as a base, preferred over a published package of the same id', async () =>
{
    const provider = new ServiceProvider()
    provider.registerInstance(PackageStoreKey, Fixtures.Published({ 'mm@1.0.0': /* stale published */ someSourced() }))
    provider.registerInstance(SolutionManagerService.Key, Fixtures.Manager([
        { id: 'mm', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('mm', '1.0.0', 'Widget')) },
    ]))
    const resolver = new SolutionBaseResolver(provider)
    const got = await resolver.TryGet({ id: 'mm', version: '1.0.0' })
    assert.ok(got !== undefined)
    // The live compile's document contains the live concept 'Widget', not the stale published node.
    assert.ok(got!.Document.nodes.some((n) => /* names Widget */ true))
})

test('no matching member → delegates to the inner published source', async () =>
{
    const provider = new ServiceProvider()
    const published = someSourced()
    provider.registerInstance(PackageStoreKey, Fixtures.Published({ 'lib@2.0.0': published }))
    provider.registerInstance(SolutionManagerService.Key, Fixtures.Manager([]))
    const resolver = new SolutionBaseResolver(provider)
    assert.equal(await resolver.TryGet({ id: 'lib', version: '2.0.0' }), published)
})

test('a non-producer (architecture) member with a colliding id never shadows the published base', async () =>
{
    const provider = new ServiceProvider()
    const published = someSourced()
    provider.registerInstance(PackageStoreKey, Fixtures.Published({ 'arch@1.0.0': published }))
    provider.registerInstance(SolutionManagerService.Key, Fixtures.Manager([
        { id: 'arch', type: 'architecture', storage: Fixtures.Storage({ 'project.plexus': JSON.stringify({ type: 'architecture', name: 'arch' }) }) },
    ]))
    const resolver = new SolutionBaseResolver(provider)
    assert.equal(await resolver.TryGet({ id: 'arch', version: '1.0.0' }), published)
})

test('an unresolved member (Storage undefined) is skipped, not compiled', async () =>
{
    const provider = new ServiceProvider()
    provider.registerInstance(PackageStoreKey, Fixtures.Published({}))
    provider.registerInstance(SolutionManagerService.Key, Fixtures.Manager([
        { id: 'mm', type: 'meta-model', storage: undefined },
    ]))
    const resolver = new SolutionBaseResolver(provider)
    assert.equal(await resolver.TryGet({ id: 'mm', version: '1.0.0' }), undefined) // no throw
})
```

Fill the `Fixtures` helper bodies using the engine's existing in-memory `IStorage` test double (reuse the pattern from a sibling `engine/tests/` file — grep for an existing fake IStorage; do not invent a new shape). `someSourced()` returns a minimal `SourcedPackage { Document: { nodes: [], edges: [] }, Dependencies: [] }`.

- [ ] **Step 2: Run the tests, verify they fail** (module not found / `SolutionBaseResolver` undefined).

Run: `npx tsx --conditions=development --test src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`
Expected: FAIL (cannot find `../solution-base-resolver.js`).

- [ ] **Step 3: Implement `SolutionBaseResolver` (plain live-first, no cache yet).**

```ts
// solution-base-resolver.ts
import { ServiceBase, ServiceKey, type IServiceProvider, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type IPackageSource, type SourcedPackage } from '../../todl-build-system/package-source.js'
import { PackageStoreKey } from '../../todl-build-system/package-store.js'
import { type PackageRef } from '../../../publish/publish.js'
import { ProjectModelProvider } from '../../project-services/generators/project-model-provider.js'
import { ProjectType, type ProjectManifest, parseManifest } from '../../package-manager/manifest.js'
import { PROJECT_MANIFEST_FILENAME } from '../../project-services/core/project-factory.js'
import { SolutionManagerService } from './solution-manager-service.js'

// A live-first IPackageSource: a base ref that names an open, resolved producer
// member of the current solution is compiled from that member's LIVE sources
// (so an unpublished sibling still resolves); every other ref delegates to the
// inner published source (PackageStoreKey). Recursive + cycle-guarded: a member's
// own bases resolve through the same instance. TODL-side, host-free.
export class SolutionBaseResolver extends ServiceBase implements IPackageSource
{
    public static readonly Key = new ServiceKey<SolutionBaseResolver>('SolutionBaseResolver')

    // DFS resolution path (member ids currently being compiled) — genuine cycles
    // are blocked, diamonds allowed.
    private readonly resolving = new Set<string>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
    }

    public async TryGet(ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        const member = await this.liveProducerFor(ref.id)
        if (member !== undefined && !this.resolving.has(ref.id))
        {
            const live = await this.compileMember(ref.id, member.storage, member.manifest)
            if (live !== undefined) return live
        }
        return this.inner().TryGet(ref)
    }

    // The open, resolved producer member whose manifest id === id, with its parsed
    // manifest; undefined if none (or the member is unresolved / non-producer).
    private async liveProducerFor(id: string): Promise<{ storage: IStorage; manifest: ProjectManifest } | undefined>
    {
        const manager = this.Provider.get(SolutionManagerService.Key)
        if (manager === undefined) return undefined
        for (const m of manager.Members)
        {
            const storage = m.Storage
            if (storage === undefined) continue
            const manifest = parseManifest(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
            if (manifest.id !== id) continue
            if (manifest.type !== ProjectType.MetaModel && manifest.type !== ProjectType.Library) continue
            return { storage, manifest }
        }
        return undefined
    }

    private async compileMember(id: string, storage: IStorage, manifest: ProjectManifest): Promise<SourcedPackage | undefined>
    {
        this.resolving.add(id)
        try
        {
            const model = await new ProjectModelProvider(storage, manifest, this).Compile()
            if (model.package === undefined) return undefined // live-compile failed → published fallback
            return { Document: model.package.document, Dependencies: model.package.document.dependencies ?? [] }
        }
        finally
        {
            this.resolving.delete(id)
        }
    }

    private inner(): IPackageSource
    {
        return this.Provider.get(PackageStoreKey) ?? SolutionBaseResolver.EmptySource
    }

    private static readonly EmptySource: IPackageSource =
        { TryGet(): Promise<SourcedPackage | undefined> { return Promise.resolve(undefined) } }
}

export default SolutionBaseResolver
```

Note: `manager.Members` is an `ObservableCollection<SolutionMember>`; iterate it directly or via `.ToArray()` per the collection's API (check the sibling usage). `ProjectModelProvider.Compile()` returns `{ package?: CompiledPackage; errors }`; `package.document` is a `PackageDocument` (a `TodlDocument` + optional `dependencies`).

- [ ] **Step 4: Run the tests, verify they pass.**

Run: `npx tsx --conditions=development --test src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Add the recursion + cycle tests.**

```ts
test('a member bound to another open member resolves transitively', async () =>
{
    // members: base 'mm' (meta-model, concept Widget); 'lib' (library) whose
    // project.plexus binds metaModels:[{id:'mm',version:'1.0.0'}] and whose .todl
    // uses a Widget-derived term. TryGet({id:'lib',...}) compiles lib live, which
    // resolves mm live through the same resolver. Assert lib's document compiled ok
    // (no unresolved-base error) — i.e. TryGet returned a defined SourcedPackage.
})

test('an A→B→A member cycle terminates without overflow', async () =>
{
    // members 'a' and 'b' each bind the other. TryGet({id:'a',...}) must return
    // (defined-or-undefined) without infinite recursion. Assert it resolves within
    // a bounded time and does not throw a RangeError.
})
```

- [ ] **Step 6: Run all resolver tests, verify pass. Commit.**

```bash
git add src/solution-services/solution-manager/engine/solution-base-resolver.ts src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts
git commit -m "feat(solution): SolutionBaseResolver — live-first IPackageSource over the published source"
```

---

### Task 3: Cache, dependency graph, and the StaleMembers signal

**Files:**
- Modify: `src/solution-services/solution-manager/engine/solution-base-resolver.ts`
- Modify: `src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`

**Interfaces:**
- Produces (added to `SolutionBaseResolver`):
  - `public Invalidate(memberId: string): void` — drops the cached compile for `memberId` and every transitive dependent, then raises the stale signal for that id set.
  - `public get StaleMemberIds(): ReadonlySet<string>` — the last-invalidated id set; setting it raises `RaisePropertyChanged('StaleMemberIds', old, next)`.
  - Internally: a `Map<string, SourcedPackage>` per-member cache and a `dependentsOf(id)` graph derived from member manifests' `metaModels`/`libraries` bindings.

- [ ] **Step 1: Write the failing cache + signal tests.**

```ts
test('a second TryGet for the same member returns the cached compile (no recompile)', async () =>
{
    // Wrap ProjectModelProvider compile count via a member storage whose ReadText is
    // counted, OR assert the returned SourcedPackage is the SAME object reference on
    // the second call. Assert identity equality across two TryGet calls for 'mm'.
})

test('Invalidate drops only the member and its transitive dependents', async () =>
{
    // members: mm (base), lib (binds mm), arch-consumer (binds lib). Prime the cache
    // by resolving all three. Invalidate('mm'). Assert: mm and lib and any dependent
    // that transitively binds mm are evicted (next TryGet recompiles), while an
    // UNRELATED cached member 'other' survives (same object reference on re-TryGet).
})

test('Invalidate raises StaleMemberIds with exactly the evicted id set', async () =>
{
    // Subscribe to PropertyChanged('StaleMemberIds'). Invalidate('mm'). Assert the
    // raised set === { 'mm', 'lib', ...transitive dependents }, not the whole solution.
})
```

- [ ] **Step 2: Run, verify they fail** (`Invalidate`/`StaleMemberIds` not defined).

- [ ] **Step 3: Add the cache, graph, and signal.**

Cache the `SourcedPackage` in `compileMember` keyed by member id. Build `dependentsOf(id)` by reading each member manifest's `metaModels`/`libraries` ids (compute lazily and rebuild on `Members`-collection change — subscribe to `manager.Members` in the constructor and clear the whole cache + graph on add/remove, which is the coarse Wave-1 trigger; `Invalidate(memberId)` is the precise trigger). `Invalidate` computes the transitive dependent set (BFS over `dependentsOf`), deletes those cache entries, and sets `StaleMemberIds` to that set (raising `PropertyChanged`).

```ts
// added members
private readonly cache = new Map<string, SourcedPackage>()
private _staleMemberIds: ReadonlySet<string> = new Set<string>()

public get StaleMemberIds(): ReadonlySet<string> { return this._staleMemberIds }

public Invalidate(memberId: string): void
{
    const evicted = this.withDependents(memberId)   // BFS over dependentsOf
    for (const id of evicted) this.cache.delete(id)
    const old = this._staleMemberIds
    this._staleMemberIds = evicted
    this.RaisePropertyChanged('StaleMemberIds', old, evicted)
}
```

In the constructor, subscribe to the manager's `Members` collection change (if a `SolutionManagerService` is present) to clear `this.cache` and any memoised graph — coarse but correct for Wave 1. Guard against no manager (headless).

Update `compileMember` to check/populate `this.cache` (return the cached `SourcedPackage` by reference on a hit).

- [ ] **Step 4: Run all resolver tests, verify pass.**

- [ ] **Step 5: Commit.**

```bash
git add src/solution-services/solution-manager/engine/solution-base-resolver.ts src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts
git commit -m "feat(solution): SolutionBaseResolver cache + dependency graph + StaleMembers signal"
```

---

### Task 4: Wire the composer's generator source to SolutionBaseResolver

**Files:**
- Modify: `src/solution-services/project-services/composition/project-system-composer.ts` (the `ResolveSource` method)
- Modify: `src/solution-services/project-services/composition/tests/project-system-composer.test.ts`
- Modify: `src/index.ts` (export `SolutionBaseResolver` + its `Key`)

**Interfaces:**
- Consumes: `SolutionBaseResolver`/`SolutionBaseResolver.Key` (`../../solution-manager/engine/solution-base-resolver.js`), `SolutionManagerService` (`../../solution-manager/engine/solution-manager-service.js`), existing `PackageStoreKey`, `IPackageSource`.
- Produces: `ResolveSource(provider, explicit)` returns, in order: `explicit` → a `SolutionBaseResolver` (when a `SolutionManagerService` is registered) → `provider.get(PackageStoreKey)` → the empty source.

- [ ] **Step 1: Write the failing composer test.**

```ts
// project-system-composer.test.ts — add
test('generators resolve bases through SolutionBaseResolver when a SolutionManagerService is registered', async () =>
{
    // Compose a container that also registers a fake SolutionManagerService holding an
    // unpublished producer member 'mm' (live concept Widget) and a consumer member that
    // binds mm. Raise a Created event for the consumer on ProjectEventsKey. Assert the
    // consumer's generator ran against a model that includes the live base (e.g. the
    // spied generator saw a ProjectModel whose bases include Widget) — i.e. resolution
    // used the live sibling, not published-empty.
})

test('with no SolutionManagerService the composer falls back to PackageStoreKey/empty (unchanged)', async () =>
{
    // Existing composer generator test path: no SolutionManagerService registered;
    // assert the generator still runs and the source is the published store / empty
    // (no throw, behavior identical to before this task).
})
```

Reuse the composer test's existing fake generator/event harness (the file already spies a generator on a Created event — extend that, do not rebuild it).

- [ ] **Step 2: Run, verify the first test fails** (source is published-empty, live base absent).

- [ ] **Step 3: Update `ResolveSource`.**

```ts
private static ResolveSource(provider: IServiceProvider, explicit?: IPackageSource): IPackageSource
{
    if (explicit !== undefined) return explicit
    if (provider.get(SolutionManagerService.Key) !== undefined) return new SolutionBaseResolver(provider)
    return provider.get(PackageStoreKey) ?? new ProjectSystemComposer.EmptyPackageSource()
}
```

`SolutionBaseResolver` composes over `PackageStoreKey` internally, so the published fallback still applies for non-member refs. Keep the call site lazy (per event), as today.

- [ ] **Step 4: Add the barrel export.**

In `src/index.ts`, export `SolutionBaseResolver` (and its `Key`) alongside the other solution-engine exports. It is browser-safe (imports only todl-runtime + TODL internals: `ProjectModelProvider`, manifest, package-source types), so it may sit on the main barrel — verify the existing browser-safe-composition guard test still passes (it bundles the barrel for `platform:browser`).

- [ ] **Step 5: Run the composer tests + the browser-safe guard test, verify pass.**

Run: `npx tsx --conditions=development --test src/solution-services/project-services/composition/tests/project-system-composer.test.ts` and the browser-safe guard test.
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/solution-services/project-services/composition/project-system-composer.ts src/solution-services/project-services/composition/tests/project-system-composer.test.ts src/index.ts
git commit -m "feat(composition): generators resolve bases via SolutionBaseResolver when a solution is open"
```

---

### Task 5: Full-suite + typecheck gate

**Files:** none (verification task).

- [ ] **Step 1: Run the full TODL suite.**

Run: `npm test`
Expected: all pass (baseline was 1296/1296; this adds tests, so the count rises and `fail 0`).

- [ ] **Step 2: Run typecheck; confirm no net-new errors vs base `worktree-build-modules` (a096df2, which had 19 pre-existing test-file errors).**

Run: `npm run typecheck`
Expected: the same 19 pre-existing errors, none new.

- [ ] **Step 3: If green, no commit needed (verification only). Record the counts in the task report.**

---

## Self-Review notes

- **Spec coverage:** §1 SolutionMember.Storage → Task 1; §2 SolutionBaseResolver TryGet/live-first/cycle/fallback → Task 2; §3 cache/graph/StaleMembers → Task 3; §4 composer wiring → Task 4; §5 scope boundary → inherent (resolver reads only `Members`); §6 tests → distributed across Tasks 1–4 with the full gate in Task 5; §7 rollout → this branch `wave1-solution-base-resolver`.
- **Type consistency:** `TryGet(ref: PackageRef): Promise<SourcedPackage|undefined>` and `SourcedPackage { Document, Dependencies }` used identically in Tasks 2–4; `ProjectModelProvider(storage, manifest, source).Compile(): {package?: CompiledPackage}`; `package.document: PackageDocument` (has optional `dependencies`); `SolutionBaseResolver.Key`, `Invalidate(memberId)`, `StaleMemberIds` consistent across Tasks 2–4.
- **Review Focus:** the five listed inputs each have a pinning test — unresolved member (T2 step 1), live-compile failure→undefined (T2, via `model.package === undefined`), A→B→A cycle (T2 step 5), no SolutionManagerService (T4 step 1 second test), non-producer id collision (T2 step 1 third test).
