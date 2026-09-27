# Wave 3a — Solution open-projects + resolver editor surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the TODL primitives Plexus will adopt in W3b/W3c — per-project open/close over an ambient solution, and the editor-facing resolution surface folded onto `SolutionBaseResolver` — and ship them as `@pragmatic-tech-ai/todl@0.38.0`.

**Architecture:** Two independent components in `solution-services/solution-manager/engine/`. Component 1 extends `SolutionManagerService`/`Solution` with loose-project open/close backed by an auto-created untitled "ambient" solution. Component 2 ports the retiring Plexus `WorkspaceBaseResolver`'s editor-facing methods onto `SolutionBaseResolver`, reusing its live-member machinery and the `inner()` (`PackageStoreKey`) published source. Host-free throughout.

**Tech Stack:** TypeScript, `@pragmatic-tech-ai/todl-runtime` (`ServiceBase`, `IStorage`, `ObservableCollection`), `node:test` + `node:assert/strict` (NOT vitest — that is Plexus).

**Spec:** `docs/superpowers/specs/2026-09-27-w3a-solution-open-projects-design.md`

## Global Constraints

- **OOP, no free functions / module-level state.** Every function is a method or a `private static` member. The ported `tagOrigin` becomes a `private static` method.
- **Allman braces** (opening brace on its own line for class/method/control-flow; object literals and arrow bodies stay inline).
- **No inline string literals.** Reused literals and interpolated message templates live as `private static readonly` constants or `private static` message-builder methods (one home each). Structural single-use tokens (`'/'`, `typeof` guards, `':'` separators, `` `${id}@${version}` `` keys built once) may stay inline.
- **PascalCase** for public methods and interfaces. The port renames `referencedPublishedRefs` → `ReferencedPublishedRefs`.
- **Services extend `ServiceBase`**; notifications via `RaisePropertyChanged`. No dependency-property use.
- **Host-free:** no import from `mural`, Plexus, Electron, or node builtins in product code. Published lookups go through `this.inner()` (`PackageStoreKey`), never `ensurePackagesBackend` or direct `model.json` reads.
- **Tests live in a `tests/` subfolder** next to the source, using `node:test`.
- **Do NOT port** `DependentsOf` / `RefreshDependentsOfIds` (W3c replaces them). Leave `TryGet` / `Invalidate` / `StaleMemberIds` / `baseIdsOf` unchanged.

## Review Focus

- `OpenProject` on the same location twice → dedupe (return the existing member). → Task 2.
- `OpenProject` while a titled `.pksln` solution is active → member path resolves under the solution root, and the solution IS dirtied; only an untitled/ambient solution stays non-dirty. → Task 2.
- A binding whose producer is open but whose live compile fails → surface the producer's compile errors as `problems` AND fall through to the published copy for the base doc (don't drop the base). → Task 4.
- Diamond vs genuine cycle → same producer via two branches resolves once, no cycle problem; a self-binding producer yields exactly one "cyclic local reference" problem and falls back to published. → Task 4.
- A binding ref whose published `model.json` is absent → `ResolveBasesFor` emits one "not published" problem; `ReferencedPublishedRefs` records that ref's own `id@version` and stops. → Tasks 4, 5.

---

## File Structure

- `src/solution-services/solution-manager/engine/solution.ts` — add `OpenOne`; `OpenMembers` becomes a loop over it (Task 1).
- `src/solution-services/solution-manager/engine/solution-manager-service.ts` — add `EnsureActiveSolution`, `OpenProject`, `CloseProject`, path/storage helpers (Tasks 2–3).
- `src/solution-services/solution-manager/engine/solution-base-resolver.ts` — add `ResolveBasesFor`, `ReferencedPublishedRefs`, `WorkspaceProducers`, `ProducedIdOf`, `readManifest`, message-builders (Tasks 4–6).
- `src/index.ts` — export `DependencyRef` (Task 6).
- Tests: `tests/open-members.test.ts` (extend, Task 1), `tests/open-project.test.ts` (new, Tasks 2–3), `tests/solution-base-resolver.test.ts` (extend, Tasks 4–6).

---

## Task 1: `Solution.OpenOne` extraction

**Files:**
- Modify: `src/solution-services/solution-manager/engine/solution.ts:85-103`
- Test: `src/solution-services/solution-manager/engine/tests/open-members.test.ts`

**Interfaces:**
- Consumes: existing `MemberStorageResolver`, `ProjectFactoryResolver` types already imported by `solution.ts`; `SolutionMember`.
- Produces: `Solution.OpenOne(member: SolutionMember, storageFor: MemberStorageResolver, factoryFor: ProjectFactoryResolver): Promise<void>` — opens exactly one member (used by `OpenMembers` and by `SolutionManagerService.OpenProject`).

- [ ] **Step 1: Write the failing test** — append to `open-members.test.ts`:

```ts
test('OpenOne opens a single member; OpenMembers delegates to it', async () => {
    const s = new Solution('S', new FakeStorage())
    const m = s.AddMember('./api', 'architecture')
    const arch = new FakeProjectFactory()
    await s.OpenOne(m, (rel) => new FakeStorage(`root:${rel}`), () => arch)
    assert.equal(m.IsResolved, true)
    assert.equal(m.Storage!.Root, 'root:./api')
    assert.equal(arch.openCount, 1)
})

test('OpenOne leaves a member with no factory unresolved', async () => {
    const s = new Solution('S', new FakeStorage())
    const m = s.AddMember('./x', 'not-installed')
    await s.OpenOne(m, () => new FakeStorage(), () => undefined)
    assert.equal(m.IsResolved, false)
    assert.equal(m.Storage, undefined)
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx tsx --test src/solution-services/solution-manager/engine/tests/open-members.test.ts`
Expected: FAIL — `s.OpenOne is not a function`.

- [ ] **Step 3: Extract `OpenOne` and reduce `OpenMembers` to a loop** — replace the body of `OpenMembers` (solution.ts:85-103) with:

```ts
    public async OpenMembers(
        storageFor: MemberStorageResolver,
        factoryFor: ProjectFactoryResolver,
    ): Promise<void>
    {
        for (const member of this.Members) await this.OpenOne(member, storageFor, factoryFor);
    }

    // Open exactly one member: resolve its factory + storage and stash the handle.
    // A member whose type has no registered factory stays unresolved (Project/Storage
    // undefined) — no throw, so one missing module doesn't break the solution.
    public async OpenOne(
        member: SolutionMember,
        storageFor: MemberStorageResolver,
        factoryFor: ProjectFactoryResolver,
    ): Promise<void>
    {
        const factory = factoryFor(member.Ref.type);
        if (factory === undefined)
        {
            member.Project = undefined;
            member.Storage = undefined;
            return;
        }
        const storage = storageFor(member.Ref.path);
        member.Storage = storage;
        member.Project = await factory.openProject(storage);
    }
```

Ensure `SolutionMember` is imported in `solution.ts` (it is — `Members` is `ObservableCollection<SolutionMember>`).

- [ ] **Step 4: Run the whole file and verify green** (the three pre-existing `OpenMembers` tests must still pass — this is a pure extraction)

Run: `npx tsx --test src/solution-services/solution-manager/engine/tests/open-members.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/solution-services/solution-manager/engine/solution.ts src/solution-services/solution-manager/engine/tests/open-members.test.ts
git commit -m "refactor(solution): extract Solution.OpenOne from OpenMembers"
```

---

## Task 2: `SolutionManagerService.OpenProject` + ambient solution

**Files:**
- Modify: `src/solution-services/solution-manager/engine/solution-manager-service.ts`
- Test: `src/solution-services/solution-manager/engine/tests/open-project.test.ts` (new)

**Interfaces:**
- Consumes: `Solution.OpenOne` (Task 1); `parseManifest`, `PROJECT_MANIFEST_FILENAME`, `SolutionMember`.
- Produces:
  - `SolutionManagerService.OpenProject(location: string): Promise<SolutionMember>`
  - `private EnsureActiveSolution(): Solution`
  - `private memberPathFor(solution: Solution, location: string): string`
  - `private memberStorageFor(solution: Solution, memberPath: string): IStorage`

- [ ] **Step 1: Write the failing tests** — create `tests/open-project.test.ts`. Reuse the harness pattern from `solution-manager-service.test.ts` (copy its `makeService` helper — the factory registry must resolve the project types the tests open). Seed the project manifest into the storage `makeService`'s registry returns for the location, then:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage, /* … */ } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionManagerService } from '../solution-manager-service.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../project-services/core/project-factory.js'
// makeService copied from solution-manager-service.test.ts (fake storage/factory/prompt/packages);
// its factory registry must map 'architecture' -> FakeProjectFactory.

// Seed a project.plexus so OpenProject can read the member type.
async function seedProject(roots: Map<string, FakeStorage>, location: string, type: string): Promise<void> {
    const s = roots.get(location) ?? new FakeStorage(location); roots.set(location, s)
    await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type, name: 'p', version: 1 }))
}

test('OpenProject with no active solution creates an untitled ambient solution and adds the member', async () => {
    const { svc, roots } = makeService()
    await seedProject(roots, '/work/api', 'architecture')
    const m = await svc.OpenProject('/work/api')
    assert.equal(svc.ActiveSolution!.HasLocation, false)          // ambient untitled
    assert.equal(svc.ActiveSolution!.Members.ToArray().length, 1)
    assert.equal(m.IsResolved, true)
})

test('OpenProject on an untitled ambient solution leaves it non-dirty', async () => {
    const { svc, roots } = makeService()
    await seedProject(roots, '/work/api', 'architecture')
    await svc.OpenProject('/work/api')
    assert.equal(svc.ActiveSolution!.IsDirty, false)              // loose membership isn't unsaved content
})

test('OpenProject dedupes by location (second call returns the same member)', async () => {
    const { svc, roots } = makeService()
    await seedProject(roots, '/work/api', 'architecture')
    const first = await svc.OpenProject('/work/api')
    const second = await svc.OpenProject('/work/api')
    assert.equal(second, first)
    assert.equal(svc.ActiveSolution!.Members.ToArray().length, 1)
})

test('OpenProject into a titled solution resolves the member under the solution root and dirties it', async () => {
    const { svc, roots } = makeService()
    await svc.NewSolution('/work/sol')                            // titled: Storage.Root === '/work/sol'
    await svc.Save()                                              // clean
    await seedProject(roots, '/work/sol/api', 'architecture')
    const m = await svc.OpenProject('/work/sol/api')
    assert.equal(m.Ref.path, 'api')                              // relative to the solution root
    assert.equal(m.IsResolved, true)
    assert.equal(svc.ActiveSolution!.IsDirty, true)             // titled membership changed
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx tsx --test src/solution-services/solution-manager/engine/tests/open-project.test.ts`
Expected: FAIL — `svc.OpenProject is not a function`.

- [ ] **Step 3: Implement** — add imports and methods to `solution-manager-service.ts`:

```ts
import { parseManifest } from '../../package-manager/manifest.js';
import { PROJECT_MANIFEST_FILENAME } from '../../project-services/core/project-factory.js';
import { type SolutionMember } from './solution-member.js';
```

```ts
    // Ensure there is an active solution for loose projects to live in, creating an
    // untitled ambient one on demand. No canReplace prompt — there is nothing to
    // replace — and no recents/lastSolution touched (ambient is not remembered).
    private EnsureActiveSolution(): Solution
    {
        const existing = this.ActiveSolution;
        if (existing !== undefined) return existing;
        const solution = new Solution(SolutionManagerService.UntitledName);
        this.setActive(solution);
        return solution;
    }

    // Open one loose project into the active solution (ambient untitled if none),
    // deduping by member path. Reads the project's own manifest for its type. Adding
    // a project to an untitled/ambient solution does NOT dirty it (loose membership
    // isn't unsaved solution content — so a later OpenSolution won't prompt to
    // discard); adding to a titled solution dirties it (its manifest membership
    // changed).
    public async OpenProject(location: string): Promise<SolutionMember>
    {
        const solution = this.EnsureActiveSolution();
        const memberPath = this.memberPathFor(solution, location);
        const existing = solution.Members.ToArray().find((m) => m.Ref.path === memberPath);
        if (existing !== undefined) return existing;
        const storage = this.storages.CreateStorage(location);
        const manifest = parseManifest(await storage.ReadText(PROJECT_MANIFEST_FILENAME));
        const wasUntitled = !solution.HasLocation;
        const member = solution.AddMember(memberPath, manifest.type);
        await solution.OpenOne(
            member,
            (rel) => this.memberStorageFor(solution, rel),
            (type) => this.factories.factoryFor(type),
        );
        if (wasUntitled) solution.IsDirty = false;
        return member;
    }

    // The member path stored in a solution: relative to the solution root when the
    // location is under a titled solution's folder; otherwise the absolute location
    // (untitled/ambient, or a project outside the solution folder).
    private memberPathFor(solution: Solution, location: string): string
    {
        const root = solution.Storage?.Root;
        if (root === undefined) return location;
        return SolutionManagerService.relativeUnderRoot(root, location) ?? location;
    }

    // Resolve a member's storage the way it was pathed: an absolute member path (or
    // an untitled solution) goes straight to CreateStorage; a relative path is joined
    // under the solution root — the same rule OpenSolution's storageFor uses.
    private memberStorageFor(solution: Solution, memberPath: string): IStorage
    {
        const root = solution.Storage?.Root;
        if (root === undefined || SolutionManagerService.isAbsolute(memberPath))
            return this.storages.CreateStorage(memberPath);
        return this.storages.CreateStorage(SolutionManagerService.joinPosix(root, memberPath));
    }

    private static relativeUnderRoot(root: string, location: string): string | undefined
    {
        const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
        const l = location.replace(/\\/g, '/');
        if (l === r) return '.';
        const prefix = `${r}/`;
        return l.startsWith(prefix) ? l.slice(prefix.length) : undefined;
    }

    private static isAbsolute(p: string): boolean
    {
        return p.startsWith('/') || /^[A-Za-z]:/.test(p);
    }
```

- [ ] **Step 4: Run and verify green**

Run: `npx tsx --test src/solution-services/solution-manager/engine/tests/open-project.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/solution-services/solution-manager/engine/solution-manager-service.ts src/solution-services/solution-manager/engine/tests/open-project.test.ts
git commit -m "feat(solution): OpenProject + ambient untitled solution"
```

---

## Task 3: `SolutionManagerService.CloseProject`

**Files:**
- Modify: `src/solution-services/solution-manager/engine/solution-manager-service.ts`
- Test: `src/solution-services/solution-manager/engine/tests/open-project.test.ts`

**Interfaces:**
- Produces: `SolutionManagerService.CloseProject(member: SolutionMember): Promise<void>`.

- [ ] **Step 1: Write the failing tests** — append to `open-project.test.ts`:

```ts
test('CloseProject removes the member from the active solution', async () => {
    const { svc, roots } = makeService()
    await seedProject(roots, '/work/api', 'architecture')
    const m = await svc.OpenProject('/work/api')
    await svc.CloseProject(m)
    assert.equal(svc.ActiveSolution!.Members.ToArray().length, 0)
})

test('CloseProject on an untitled solution leaves it non-dirty', async () => {
    const { svc, roots } = makeService()
    await seedProject(roots, '/work/api', 'architecture')
    const m = await svc.OpenProject('/work/api')
    await svc.CloseProject(m)
    assert.equal(svc.ActiveSolution!.IsDirty, false)
})

test('CloseProject with no active solution is a no-op', async () => {
    const { svc } = makeService()
    await assert.doesNotReject(svc.CloseProject({ Ref: { path: 'x', type: 'architecture' } } as never))
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx tsx --test src/solution-services/solution-manager/engine/tests/open-project.test.ts`
Expected: FAIL — `svc.CloseProject is not a function`.

- [ ] **Step 3: Implement** — add to `solution-manager-service.ts`:

```ts
    // Close one loose project: dispose its opened handle if disposable, then drop it
    // from the active solution. No-op when there is no active solution or the member
    // isn't one of its members. Dirty rule mirrors OpenProject (untitled stays clean).
    public async CloseProject(member: SolutionMember): Promise<void>
    {
        const solution = this.ActiveSolution;
        if (solution === undefined) return;
        if (!solution.Members.ToArray().includes(member)) return;
        const wasUntitled = !solution.HasLocation;
        (member.Project as { dispose?: () => void } | undefined)?.dispose?.();
        solution.RemoveMember(member);
        if (wasUntitled) solution.IsDirty = false;
    }
```

- [ ] **Step 4: Run and verify green**

Run: `npx tsx --test src/solution-services/solution-manager/engine/tests/open-project.test.ts`
Expected: PASS (7 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add src/solution-services/solution-manager/engine/solution-manager-service.ts src/solution-services/solution-manager/engine/tests/open-project.test.ts
git commit -m "feat(solution): CloseProject removes + disposes a loose member"
```

---

## Task 4: `SolutionBaseResolver.ResolveBasesFor`

**Files:**
- Modify: `src/solution-services/solution-manager/engine/solution-base-resolver.ts`
- Test: `src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`

**Interfaces:**
- Consumes: existing `liveProducerFor`, `inner()`, `WikiLocator`/`WikiOrigin`, `ProjectModelProvider.CompileWithBases`, `ProjectType`, `parseManifest`, `PROJECT_MANIFEST_FILENAME`, `DependencyRef`, `PackageKind`, `PackageRef`, `TodlDocument`.
- Produces: `SolutionBaseResolver.ResolveBasesFor(consumerStorage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[]; originOf: ReadonlyMap<string, WikiOrigin> }>` and private `readManifest`, `resolveBindingsInto`, `resolveOneBase`, `resolvePublishedBase`, `liveProducerOfKind`, and the `tagOrigin`/message-builder statics.

- [ ] **Step 1: Write the failing tests** — append to `solution-base-resolver.test.ts`. Reuse `Fixtures`; add a `Fixtures.PublishedDoc(nodes)` helper that returns a `SourcedPackage` with real nodes and optional dependencies. Add a consumer-manifest fixture (a project binding a base). Example cases:

```ts
import { WikiOriginKind } from '../../../project-services/core/wiki-origin.js'

test('ResolveBasesFor prefers an open producer and tags its nodes with an OpenProject origin', async () => {
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '1.0.0', 'Gadget', 'Widget'))
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'mm', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('mm', '1.0.0', 'Widget')) },
        ]),
        Fixtures.Published({ 'mm@1.0.0': Fixtures.PublishedDoc([{ id: 'StaleWidget' }]) }),
    )
    const resolver = new SolutionBaseResolver(provider)
    const { bases, problems, originOf } = await resolver.ResolveBasesFor(consumer)
    assert.ok(bases.some((b) => b.nodes.some((n) => n.id === 'Widget')))   // live, not StaleWidget
    assert.equal(originOf.get('Widget')!.kind, WikiOriginKind.OpenProject)
    assert.deepEqual(problems, [])
})

test('ResolveBasesFor falls back to published and tags Package origin, recursing deps', async () => {
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '1.0.0', 'Gadget', 'Widget'))
    const provider = Fixtures.Provider(
        Fixtures.Manager([]),   // no open producer
        Fixtures.Published({ 'mm@1.0.0': Fixtures.PublishedDoc([{ id: 'Widget' }], [{ kind: 'meta-model', id: 'core', version: '2.0.0' }]),
                             'core@2.0.0': Fixtures.PublishedDoc([{ id: 'Base' }]) }),
    )
    const resolver = new SolutionBaseResolver(provider)
    const { bases, originOf } = await resolver.ResolveBasesFor(consumer)
    assert.ok(bases.some((b) => b.nodes.some((n) => n.id === 'Widget')))
    assert.ok(bases.some((b) => b.nodes.some((n) => n.id === 'Base')))     // transitive dep
    assert.equal(originOf.get('Widget')!.kind, WikiOriginKind.Package)
})

test('ResolveBasesFor emits a not-published problem for an absent base', async () => {
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('lib', 'ghost', '9.9.9', 'G', 'X'))
    const provider = Fixtures.Provider(Fixtures.Manager([]), Fixtures.Published({}))
    const resolver = new SolutionBaseResolver(provider)
    const { problems } = await resolver.ResolveBasesFor(consumer)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /ghost@9\.9\.9.*not published/)
})

test('ResolveBasesFor reports a version mismatch against an open producer', async () => {
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '2.0.0', 'Gadget', 'Widget')) // wants @2.0.0
    const provider = Fixtures.Provider(
        Fixtures.Manager([{ id: 'mm', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('mm', '1.0.0', 'Widget')) }]), // is @1.0.0
        Fixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)
    const { problems } = await resolver.ResolveBasesFor(consumer)
    assert.ok(problems.some((p) => /binding requests @2\.0\.0, project is @1\.0\.0/.test(p)))
})

test('ResolveBasesFor: a self-binding producer yields one cyclic problem and falls back to published', async () => {
    // consumer binds 'a'; 'a' is an open library that binds itself.
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('c', 'a', '1.0.0', 'C', 'A'))
    const provider = Fixtures.Provider(
        Fixtures.Manager([{ id: 'a', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryFiles('a', 'a', '1.0.0', 'A', 'A')) }]),
        Fixtures.Published({ 'a@1.0.0': Fixtures.PublishedDoc([{ id: 'A' }]) }),
    )
    const resolver = new SolutionBaseResolver(provider)
    const { problems } = await resolver.ResolveBasesFor(consumer)
    assert.equal(problems.filter((p) => /cyclic local reference to "a"/.test(p)).length, 1)
})
```

(If a case needs a producer whose live compile fails, seed a `MetaModelFiles` variant with a broken `.todl` body so `ProjectModelProvider` returns `errors` and no `package`; assert the errors surface AND the published copy is still added.)

- [ ] **Step 2: Run and verify it fails**

Run: `npx tsx --test src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`
Expected: FAIL — `resolver.ResolveBasesFor is not a function`.

- [ ] **Step 3: Implement** — add imports and methods to `solution-base-resolver.ts`:

```ts
import { ProjectType, type ProjectManifest, type DependencyRef, parseManifest } from '../../../package-manager/manifest.js'
import { WikiLocator, type WikiOrigin } from '../../project-services/core/wiki-origin.js'
import { PackageKind } from '../../../publish/publish.js'
// TodlDocument: import from the same module package-source.ts imports it (domain).
```

```ts
    // Resolve a consumer's declared bases local-first (open solution members compiled
    // live, preferred over published), tagging each base node with where its declaring
    // artifact lives. The editor-facing counterpart of TryGet: it merges the full base
    // closure a language server validates against and surfaces resolution diagnostics.
    public async ResolveBasesFor(consumerStorage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[]; originOf: ReadonlyMap<string, WikiOrigin> }>
    {
        const manifest = await this.readManifest(consumerStorage)
        if (manifest === undefined) return { bases: [], problems: [], originOf: new Map() }
        return this.resolveBindingsInto(consumerStorage, manifest, new Set<IStorage>([consumerStorage]), new Set<string>())
    }

    private async resolveBindingsInto(storage: IStorage, manifest: ProjectManifest, path: Set<IStorage>, seenPub: Set<string>): Promise<{ bases: TodlDocument[]; problems: string[]; originOf: Map<string, WikiOrigin> }>
    {
        const bases: TodlDocument[] = []
        const problems: string[] = []
        const originOf = new Map<string, WikiOrigin>()
        for (const ref of manifest.metaModels ?? [])
            await this.resolveOneBase(ref, ProjectType.MetaModel, storage, path, seenPub, bases, problems, originOf)
        for (const ref of manifest.libraries ?? [])
            await this.resolveOneBase(ref, ProjectType.Library, storage, path, seenPub, bases, problems, originOf)
        return { bases, problems, originOf }
    }

    private async resolveOneBase(
        ref: DependencyRef, kind: ProjectType, consumerStorage: IStorage,
        path: Set<IStorage>, seenPub: Set<string>,
        bases: TodlDocument[], problems: string[], originOf: Map<string, WikiOrigin>,
    ): Promise<void>
    {
        const producer = await this.liveProducerOfKind(ref.id, kind)
        if (producer !== undefined && producer.storage !== consumerStorage && !path.has(producer.storage))
        {
            // DFS path (not a global seen-set): add on entry, remove on backtrack —
            // catches genuine cycles while allowing diamonds.
            path.add(producer.storage)
            const child = await this.resolveBindingsInto(producer.storage, producer.manifest, path, seenPub)
            path.delete(producer.storage)
            problems.push(...child.problems)
            const model = await new ProjectModelProvider(producer.storage, producer.manifest, this).CompileWithBases(child.bases)
            for (const e of model.errors) problems.push(SolutionBaseResolver.localProblem(kind, ref.id, e))
            const producerVersion = producer.manifest.packageVersion
            if (producerVersion !== undefined && producerVersion !== ref.version)
                problems.push(SolutionBaseResolver.versionMismatch(ref.id, ref.version, producerVersion))
            if (model.package !== undefined)
            {
                bases.push(model.package.document)
                SolutionBaseResolver.tagOrigin(originOf, model.package.document, WikiLocator.OpenProjectOrigin(producer.storage))
                return
            }
            // live compile failed → fall through to the published copy so the base isn't lost
        }
        else if (producer !== undefined && path.has(producer.storage))
        {
            problems.push(SolutionBaseResolver.cyclicProblem(ref.id))
        }
        await this.resolvePublishedBase(ref, kind, seenPub, bases, problems, originOf)
    }

    private async resolvePublishedBase(
        ref: DependencyRef, kind: ProjectType, seenPub: Set<string>,
        bases: TodlDocument[], problems: string[], originOf: Map<string, WikiOrigin>,
    ): Promise<void>
    {
        const key = `${kind}:${ref.id}@${ref.version}`
        if (seenPub.has(key)) return
        seenPub.add(key)
        const sourced = await this.inner().TryGet({ kind: SolutionBaseResolver.packageKindOf(kind), id: ref.id, version: ref.version })
        if (sourced === undefined)
        {
            problems.push(SolutionBaseResolver.notPublished(kind, ref.id, ref.version))
            return
        }
        bases.push({ nodes: sourced.Document.nodes, edges: sourced.Document.edges })
        SolutionBaseResolver.tagOrigin(originOf, sourced.Document, WikiLocator.PackageOrigin(ref.id, ref.version))
        for (const dep of sourced.Dependencies)
        {
            const depKind = dep.kind === PackageKind.Library ? ProjectType.Library : ProjectType.MetaModel
            await this.resolvePublishedBase({ id: dep.id, version: dep.version }, depKind, seenPub, bases, problems, originOf)
        }
    }

    private async liveProducerOfKind(id: string, kind: ProjectType): Promise<{ storage: IStorage; manifest: ProjectManifest } | undefined>
    {
        const found = await this.liveProducerFor(id)
        return found !== undefined && found.manifest.type === kind ? found : undefined
    }

    private async readManifest(storage: IStorage): Promise<ProjectManifest | undefined>
    {
        try { return parseManifest(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) }
        catch { return undefined }
    }

    private static packageKindOf(kind: ProjectType): PackageKind
    {
        return kind === ProjectType.Library ? PackageKind.Library : PackageKind.MetaModel
    }

    // First-writer-wins: a node reached first via a live-producer binding keeps that
    // origin over a later published-diamond reach.
    private static tagOrigin(originOf: Map<string, WikiOrigin>, doc: TodlDocument, origin: WikiOrigin): void
    {
        for (const n of doc.nodes) if (!originOf.has(n.id)) originOf.set(n.id, origin)
    }

    private static localProblem(kind: ProjectType, id: string, detail: string): string
    {
        return `local ${kind} "${id}" — ${detail}`
    }
    private static versionMismatch(id: string, requested: string, actual: string): string
    {
        return `using local "${id}" (open project) — binding requests @${requested}, project is @${actual}`
    }
    private static cyclicProblem(id: string): string
    {
        return `cyclic local reference to "${id}"; using published`
    }
    private static notPublished(kind: ProjectType, id: string, version: string): string
    {
        return `${kind} "${id}@${version}" is not published`
    }
```

Confirm the `PackageKind` enum member names (`Library`, `MetaModel`) against `publish.ts`; adjust if they differ.

- [ ] **Step 4: Run and verify green**

Run: `npx tsx --test src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`
Expected: PASS (existing TryGet/Invalidate tests + the new ResolveBasesFor tests).

- [ ] **Step 5: Commit**

```bash
git add src/solution-services/solution-manager/engine/solution-base-resolver.ts src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts
git commit -m "feat(resolver): ResolveBasesFor — editor-facing base resolution + origins"
```

---

## Task 5: `SolutionBaseResolver.ReferencedPublishedRefs`

**Files:**
- Modify: `src/solution-services/solution-manager/engine/solution-base-resolver.ts`
- Test: `src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`

**Interfaces:**
- Produces: `SolutionBaseResolver.ReferencedPublishedRefs(consumerStorage: IStorage): Promise<Set<string>>` and private `collectPublishedRef`.

- [ ] **Step 1: Write the failing tests** — append:

```ts
test('ReferencedPublishedRefs returns the transitive published id@version closure', async () => {
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '1.0.0', 'G', 'W'))
    const provider = Fixtures.Provider(Fixtures.Manager([]), Fixtures.Published({
        'mm@1.0.0': Fixtures.PublishedDoc([{ id: 'W' }], [{ kind: 'meta-model', id: 'core', version: '2.0.0' }]),
        'core@2.0.0': Fixtures.PublishedDoc([{ id: 'B' }]),
    }))
    const resolver = new SolutionBaseResolver(provider)
    const refs = await resolver.ReferencedPublishedRefs(consumer)
    assert.deepEqual([...refs].sort(), ['core@2.0.0', 'mm@1.0.0'])
})

test('ReferencedPublishedRefs records an absent ref own key then stops', async () => {
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('lib', 'ghost', '9.9.9', 'G', 'X'))
    const provider = Fixtures.Provider(Fixtures.Manager([]), Fixtures.Published({}))
    const resolver = new SolutionBaseResolver(provider)
    const refs = await resolver.ReferencedPublishedRefs(consumer)
    assert.deepEqual([...refs], ['ghost@9.9.9'])
})
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx tsx --test src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`
Expected: FAIL — `resolver.ReferencedPublishedRefs is not a function`.

- [ ] **Step 3: Implement** — add:

```ts
    // The transitive set of published base package keys (`id@version`) a project
    // references — its manifest's meta-model + library bindings plus each published
    // package's recorded dependencies. Published-only (does NOT consult open members):
    // it is the toolbox-scoping closure. Best-effort — an absent ref contributes its
    // own key; only its transitive deps are then unreachable.
    public async ReferencedPublishedRefs(consumerStorage: IStorage): Promise<Set<string>>
    {
        const manifest = await this.readManifest(consumerStorage)
        const out = new Set<string>()
        for (const ref of manifest?.metaModels ?? []) await this.collectPublishedRef(ref, ProjectType.MetaModel, out)
        for (const ref of manifest?.libraries ?? []) await this.collectPublishedRef(ref, ProjectType.Library, out)
        return out
    }

    private async collectPublishedRef(ref: DependencyRef, kind: ProjectType, out: Set<string>): Promise<void>
    {
        const key = `${ref.id}@${ref.version}`
        if (out.has(key)) return
        out.add(key)
        const sourced = await this.inner().TryGet({ kind: SolutionBaseResolver.packageKindOf(kind), id: ref.id, version: ref.version })
        if (sourced === undefined) return
        for (const dep of sourced.Dependencies)
        {
            const depKind = dep.kind === PackageKind.Library ? ProjectType.Library : ProjectType.MetaModel
            await this.collectPublishedRef({ id: dep.id, version: dep.version }, depKind, out)
        }
    }
```

- [ ] **Step 4: Run and verify green**

Run: `npx tsx --test src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/solution-services/solution-manager/engine/solution-base-resolver.ts src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts
git commit -m "feat(resolver): ReferencedPublishedRefs — published closure"
```

---

## Task 6: `WorkspaceProducers` + `ProducedIdOf` + barrel-export `DependencyRef`

**Files:**
- Modify: `src/solution-services/solution-manager/engine/solution-base-resolver.ts`
- Modify: `src/index.ts` (export `DependencyRef`)
- Test: `src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`

**Interfaces:**
- Produces:
  - `SolutionBaseResolver.WorkspaceProducers(kind: ProjectType): Promise<readonly DependencyRef[]>`
  - `SolutionBaseResolver.ProducedIdOf(consumerStorage: IStorage): Promise<string | undefined>`
  - `DependencyRef` exported from the package barrel (W3b imports it as the `WorkspaceProducers` return type).

- [ ] **Step 1: Write the failing tests** — append:

```ts
test('WorkspaceProducers lists open producers of a kind, skipping versionless ones', async () => {
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'mm', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('mm', '1.0.0', 'W')) },
            { id: 'lib', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '1.0.0', 'G', 'W')) },
        ]),
        Fixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)
    const mm = await resolver.WorkspaceProducers(ProjectType.MetaModel)
    assert.deepEqual(mm, [{ id: 'mm', version: '1.0.0' }])
})

test('ProducedIdOf returns a producer id and undefined for a non-producer', async () => {
    const provider = Fixtures.Provider(Fixtures.Manager([]), Fixtures.Published({}))
    const resolver = new SolutionBaseResolver(provider)
    const mmStorage = Fixtures.Storage(Fixtures.MetaModelFiles('mm', '1.0.0', 'W'))
    const archStorage = Fixtures.Storage({ [PROJECT_MANIFEST_FILENAME]: JSON.stringify({ type: 'architecture', name: 'a', id: 'a', version: 1 }) })
    assert.equal(await resolver.ProducedIdOf(mmStorage), 'mm')
    assert.equal(await resolver.ProducedIdOf(archStorage), undefined)
})
```

(Add `PROJECT_MANIFEST_FILENAME` to the test imports if not already present — it is imported in the existing file.)

- [ ] **Step 2: Run and verify it fails**

Run: `npx tsx --test src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`
Expected: FAIL — `resolver.WorkspaceProducers is not a function`.

- [ ] **Step 3: Implement** — add to `solution-base-resolver.ts`:

```ts
    // Every open, resolved member producing a base of `kind`, as { id, version } —
    // the References-manager catalog. A sibling can be referenced before it is
    // published (resolution prefers the open producer); a producer with no version
    // yet is skipped, since a reference needs a concrete version to record.
    public async WorkspaceProducers(kind: ProjectType): Promise<readonly DependencyRef[]>
    {
        const members = this.Provider.get(SolutionManagerService.Key)?.ActiveSolution?.Members
        if (members === undefined) return []
        const refs: DependencyRef[] = []
        for (const m of members)
        {
            const storage = m.Storage
            if (storage === undefined) continue
            const manifest = await this.readManifest(storage)
            if (manifest === undefined || manifest.type !== kind) continue
            if (manifest.id === undefined || manifest.packageVersion === undefined) continue
            refs.push({ id: manifest.id, version: manifest.packageVersion })
        }
        return refs
    }

    // The producer id a storage's manifest declares (meta-model or library), else
    // undefined.
    public async ProducedIdOf(consumerStorage: IStorage): Promise<string | undefined>
    {
        const manifest = await this.readManifest(consumerStorage)
        if (manifest === undefined) return undefined
        if (manifest.type !== ProjectType.MetaModel && manifest.type !== ProjectType.Library) return undefined
        return manifest.id
    }
```

Then export `DependencyRef` from `src/index.ts` — add `type DependencyRef` to the existing `manifest.js` re-export block (the block that already exports `ProjectType`/`parseManifest`/`ProjectManifest`). If `ProjectManifest` is exported there, add `DependencyRef` beside it.

- [ ] **Step 4: Run and verify green**

Run: `npx tsx --test src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the barrel export**

Run: `npx tsc -p tsconfig.build.json --noEmit`
Expected: no errors (confirms `DependencyRef` is exported and all new code typechecks).

- [ ] **Step 6: Commit**

```bash
git add src/solution-services/solution-manager/engine/solution-base-resolver.ts src/index.ts src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts
git commit -m "feat(resolver): WorkspaceProducers + ProducedIdOf; export DependencyRef"
```

---

## Release (after the whole-branch review passes)

Not a TDD task — the outward, norms-gated release, authorized as the W3a deliverable. Mirrors the v0.37.0 procedure.

1. Full TODL suite green: `npm test` (expect the prior 1315 + the new W3a tests, 0 fail).
2. Bump `package.json` version `0.37.0` → `0.38.0`; commit `chore(release): v0.38.0`.
3. Merge `w3a-solution-open-projects` → `main` (fast-forward from the integrated main) in the main TODL checkout; re-run `npm test` on the merged result.
4. Publish: `npm publish --userconfig "<TODL main>/.npmrc"` (auth via `$PACKAGES_TOKEN`); tag `v0.38.0`.
5. Push `main` + tag.
6. W3b then bumps Plexus's three `@pragmatic-tech-ai/todl` deps to `^0.38.0` and refreshes `node_modules` from the published build.

---

## Self-Review

- **Spec coverage:** Component 1 → Tasks 1–3 (`OpenOne`, `OpenProject`+ambient, `CloseProject`). Component 2 → Tasks 4–6 (`ResolveBasesFor`, `ReferencedPublishedRefs`, `WorkspaceProducers`, `ProducedIdOf`). Barrel export → Task 6. Release → Release section. No spec requirement is unassigned.
- **Review Focus coverage:** dedupe (Task 2 test), titled-dirty + under-root path (Task 2 test), failed-live-compile fallback (Task 4 Step 1 note), diamond/cycle (Task 4 tests), not-published + own-key-then-stop (Tasks 4 & 5 tests).
- **Type consistency:** `DependencyRef {id, version}` is the `metaModels`/`libraries` element type and the `WorkspaceProducers` return element; `PackageRef {kind, id, version}` is what `inner().TryGet` takes (built via `packageKindOf`); `sourced.Dependencies` is `readonly PackageRef[]`, recursed by id/version + `dep.kind`. `ResolveBasesFor` returns `ReadonlyMap` (built as `Map`). Message text lives only in the four `private static` builders.
- **Placeholder scan:** none — every step carries runnable test/impl code. The two "confirm" notes (TodlDocument import path; `PackageKind` member names) are explicit verification instructions, not deferrals.
