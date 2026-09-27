# Wiki-origin relocation (Wave 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `WikiOrigin` + the wiki-file locator from Plexus into TODL's solution-services as a host-free `WikiLocator`, and re-point Plexus's consumers at it.

**Architecture:** A new host-free `src/solution-services/project-services/core/wiki-origin.ts` in TODL defines `WikiOriginKind`, the `WikiOrigin` union (Package variant WITHOUT the vestigial `backend` field), and a `WikiLocator` class of static methods (`OpenProjectOrigin`, `PackageOrigin`, `PackageWikiPath`, `LocateFile(packagesStorage, origin, relPath)`). Plexus's `wiki-origin.ts` becomes a re-export; call sites move to `WikiLocator.*` and pass `ensurePackagesBackend(provider)` into `LocateFile`.

**Tech Stack:** TypeScript (ESM, strict), `@pragmatic-tech-ai/todl-runtime` (`IStorage`), node:test + tsx (TODL), vitest (Plexus).

**Spec:** docs/superpowers/specs/2026-09-27-wiki-origin-relocation-design.md

## Global Constraints

- OOP only: no free functions / module-level mutable state; the moved unit is a class of static methods. Module-level `const`/`enum`/`type` is fine.
- Allman braces; object literals + arrow bodies stay inline.
- No inline string literals for messages/keys; path composition (`/`, `<id>/<version>`) is structural and stays inline.
- PascalCase interfaces + public methods; enums not string-literal unions.
- The moved TODL unit imports ONLY `@pragmatic-tech-ai/todl-runtime` (no mural, no plexus, no `ensurePackagesBackend`).
- Tests in `tests/` subfolders. Keep files' existing line endings.
- After a TODL commit, the controller runs `bash C:/Users/Eugene/AppData/Local/Temp/claude/c--Users-Eugene-Projects-architecture-agent/fc2a7aaf-deac-4535-ac5a-6165bbbac515/scratchpad/refresh-todl.sh` to repack TODL into Plexus; the Plexus task runs after that. Never `npm install`. Run `npm run build:core` at the Plexus root before Plexus typecheck/tests.
- Commit attribution: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Review Focus

- **A package-origin page path:** `LocateFile` on a `Package` origin must read from the passed `packagesStorage` at exactly `<id>/<version>/<relPath>` (the layout Plexus consumers + the packages backend expect) — pinned in Task 1.
- **An open-project origin:** `LocateFile` must return the origin's own storage and the bare `relPath` (no packages-path rewrite) — pinned in Task 1.
- **`backend`-field removal doesn't silently change behavior:** every Plexus producer/consumer/test that referenced `Package.backend` compiles and passes with the field gone (nothing actually routed on it) — pinned in Task 2.
- **Barrel stays browser-safe:** exporting `WikiLocator` on the main barrel adds no node/esbuild edge — pinned in Task 3.

---

## File Structure

New (TODL):
- `src/solution-services/project-services/core/wiki-origin.ts` — `WikiOriginKind`, `WikiOrigin`, `WikiLocator`.
- `src/solution-services/project-services/core/tests/wiki-origin.test.ts`.

Modified (TODL):
- `src/index.ts` — export the three symbols.

Modified (Plexus):
- `apps/plexus/src/renderer/src/services/projects/wiki-origin.ts` — becomes a re-export of the TODL symbols (delete the local definitions).
- `.../services/projects/workspace-base-resolver.ts` — `openProjectOrigin`/`packageOrigin` → `WikiLocator.*` (drop the `kind` arg to PackageOrigin).
- `.../modules/architecture-projects/services/arch-model.ts` — `openProjectOrigin` → `WikiLocator.OpenProjectOrigin`.
- `.../modules/architecture-projects/services/arch-diagram-binding-service.ts` — `locateWikiFile(provider, …)` → `WikiLocator.LocateFile(ensurePackagesBackend(provider), …)`.
- `.../modules/architecture-projects/services/arch-navigation-service.ts` — import `WikiOriginKind` from the re-export (no functional change; the Package check stays).
- Tests: `.../services/projects/tests/wiki-origin.test.ts` (delete — coverage moves to TODL), `.../modules/architecture-projects/services/tests/arch-model-wiki-origin.test.ts` + `.../tests/arch-navigation-service.test.ts` + `.../services/projects/tests/workspace-base-resolver.test.ts` (drop the `backend` field / update to `WikiLocator.*`).

---

### Task 1: TODL — WikiLocator (host-free) + tests + barrel export

**Files:**
- Create: `src/solution-services/project-services/core/wiki-origin.ts`
- Create: `src/solution-services/project-services/core/tests/wiki-origin.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `enum WikiOriginKind { OpenProject='openProject', Package='package' }`; `type WikiOrigin = { kind: OpenProject; storage: IStorage } | { kind: Package; id: string; version: string }`; `class WikiLocator` with `static OpenProjectOrigin(storage): WikiOrigin`, `static PackageOrigin(id, version): WikiOrigin`, `static PackageWikiPath(id, version, relPath): string`, `static LocateFile(packagesStorage: IStorage, origin: WikiOrigin, relPath: string): { storage: IStorage; path: string }`.

- [ ] **Step 1: Write the failing test.**

```ts
// tests/wiki-origin.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { WikiOriginKind, WikiLocator } from '../wiki-origin.js'

// A minimal IStorage stand-in — only identity matters for these tests.
const projectStorage = { id: 'project' } as never
const packagesStorage = { id: 'packages' } as never

test('OpenProjectOrigin carries the storage', () =>
{
    assert.deepEqual(WikiLocator.OpenProjectOrigin(projectStorage), { kind: WikiOriginKind.OpenProject, storage: projectStorage })
})

test('PackageOrigin carries id + version (no backend field)', () =>
{
    assert.deepEqual(WikiLocator.PackageOrigin('microsoft', '1.2.0'), { kind: WikiOriginKind.Package, id: 'microsoft', version: '1.2.0' })
})

test('PackageWikiPath composes <id>/<version>/<relPath>', () =>
{
    assert.equal(WikiLocator.PackageWikiPath('microsoft', '1.2.0', 'wiki/service.md'), 'microsoft/1.2.0/wiki/service.md')
})

test('LocateFile — open-project origin returns the project storage + bare relPath', () =>
{
    const loc = WikiLocator.LocateFile(packagesStorage, WikiLocator.OpenProjectOrigin(projectStorage), 'wiki/service.md')
    assert.equal(loc.storage, projectStorage)
    assert.equal(loc.path, 'wiki/service.md')
})

test('LocateFile — package origin reads packagesStorage at <id>/<version>/<relPath>', () =>
{
    const loc = WikiLocator.LocateFile(packagesStorage, WikiLocator.PackageOrigin('ea', '0.1.0'), 'wiki/service.md')
    assert.equal(loc.storage, packagesStorage)
    assert.equal(loc.path, 'ea/0.1.0/wiki/service.md')
})
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `npx tsx --conditions=development --test src/solution-services/project-services/core/tests/wiki-origin.test.ts`
Expected: FAIL (cannot find `../wiki-origin.js`).

- [ ] **Step 3: Implement `wiki-origin.ts`** exactly as the spec's Section 1 code block (enum, `WikiOrigin` union with the `Package` variant carrying only `id`/`version`, `WikiLocator` with the four static methods; imports only `IStorage` from `@pragmatic-tech-ai/todl-runtime`; Allman braces).

- [ ] **Step 4: Run the test, verify it passes.**

- [ ] **Step 5: Export from the barrel.** In `src/index.ts`, export `WikiOriginKind`, `WikiLocator`, and `type WikiOrigin` alongside the other `project-services/core` exports (e.g. near base-binding's exports).

- [ ] **Step 6: Run the full TODL suite + typecheck; commit.**

```bash
npm test            # expect all pass (adds 5 tests)
npm run typecheck   # expect the 19 pre-existing test-file errors, none new
git add src/solution-services/project-services/core/wiki-origin.ts src/solution-services/project-services/core/tests/wiki-origin.test.ts src/index.ts
git commit -m "feat(solution): host-free WikiLocator + WikiOrigin in solution-services"
```

---

### Task 2: Plexus — re-point consumers to WikiLocator; drop the backend field

**Files:**
- Modify: `apps/plexus/src/renderer/src/services/projects/wiki-origin.ts`
- Modify: `apps/plexus/src/renderer/src/services/projects/workspace-base-resolver.ts`
- Modify: `apps/plexus/src/renderer/src/modules/architecture-projects/services/arch-model.ts`
- Modify: `apps/plexus/src/renderer/src/modules/architecture-projects/services/arch-diagram-binding-service.ts`
- Modify: `apps/plexus/src/renderer/src/modules/architecture-projects/services/arch-navigation-service.ts`
- Delete: `apps/plexus/src/renderer/src/services/projects/tests/wiki-origin.test.ts` (coverage moved to TODL Task 1)
- Modify (tests): `.../modules/architecture-projects/services/tests/arch-model-wiki-origin.test.ts`, `.../tests/arch-navigation-service.test.ts`, `.../services/projects/tests/workspace-base-resolver.test.ts`

> Runs AFTER the controller repacks TODL (so `@pragmatic-tech-ai/todl` exports `WikiLocator`). Run `npm run build:core` before typecheck/tests.

**Interfaces:**
- Consumes: `WikiOriginKind`, `WikiLocator`, `type WikiOrigin` from `@pragmatic-tech-ai/todl` (via the local re-export).

- [ ] **Step 1: Make the Plexus wiki-origin.ts a re-export.** Replace its entire contents with:

```ts
// The WikiOrigin model + locator now live in todl (solution-services); re-exported
// here so plexus import paths stay stable (mirrors base-binding.ts). The packages
// backend is passed into WikiLocator.LocateFile by the host at the call site.
export { WikiOriginKind, WikiLocator, type WikiOrigin } from '@pragmatic-tech-ai/todl'
```

- [ ] **Step 2: Update `workspace-base-resolver.ts`.** Change the import to `import { type WikiOrigin, WikiLocator } from './wiki-origin.js'`; replace `openProjectOrigin(producer.Storage)` (line ~189) with `WikiLocator.OpenProjectOrigin(producer.Storage)` and `packageOrigin(kind, ref.id, ref.version ?? '')` (line ~217) with `WikiLocator.PackageOrigin(ref.id, ref.version ?? '')` (drop the `kind` arg). `tagOrigin` and `OriginMap` are unchanged.

- [ ] **Step 3: Update `arch-model.ts`.** Import `WikiLocator` (and keep `type WikiOrigin`); replace `openProjectOrigin(this.storage)` (line ~43) with `WikiLocator.OpenProjectOrigin(this.storage)`.

- [ ] **Step 4: Update `arch-diagram-binding-service.ts`.** Import `WikiLocator` from `../../../services/projects/wiki-origin.js` and `ensurePackagesBackend` from `../../../services/projects/packages-backend.js`; replace `locateWikiFile(this.Provider, origin, path)` (line ~74) with `WikiLocator.LocateFile(ensurePackagesBackend(this.Provider), origin, path)`.

- [ ] **Step 5: Update `arch-navigation-service.ts`.** Only the import source changes (still `WikiOriginKind` from `../../../services/projects/wiki-origin.js`, now re-exported from todl); the `origin?.kind === WikiOriginKind.Package` check is unchanged.

- [ ] **Step 6: Fix the tests.**
  - Delete `apps/plexus/src/renderer/src/services/projects/tests/wiki-origin.test.ts` (its cases now live in TODL Task 1; the locator is no longer defined in Plexus).
  - `arch-model-wiki-origin.test.ts`: replace `packageOrigin(ProducerKind.Library, 'mm', '1.0.0')` with `WikiLocator.PackageOrigin('mm', '1.0.0')` (import `WikiLocator`); drop the now-unused `ProducerKind` import.
  - `arch-navigation-service.test.ts` (line ~127): the inline `{ kind: WikiOriginKind.Package, backend: 'library', id: 'tech', version: '1.0' }` → drop `backend:` → `{ kind: WikiOriginKind.Package, id: 'tech', version: '1.0' }`.
  - `workspace-base-resolver.test.ts` (line ~93): the inline `{ kind: WikiOriginKind.Package, backend: ProducerKind.MetaModel, id: 'ea', version: '0.1.0' }` → drop `backend:` (and the `ProducerKind` import if now unused).

- [ ] **Step 7: Build core, typecheck, run the affected suites.**

```bash
npm run build:core
npm run typecheck   # expect 0 errors
# affected suites:
npx vitest run apps/plexus/src/renderer/src/modules/architecture-projects/services/tests/arch-model-wiki-origin.test.ts apps/plexus/src/renderer/src/modules/architecture-projects/services/tests/arch-navigation-service.test.ts apps/plexus/src/renderer/src/services/projects/tests/workspace-base-resolver.test.ts
```
Expected: PASS (backend-field removal changes nothing behavioral).

- [ ] **Step 8: Commit.**

```bash
git add -A apps/plexus/src/renderer/src
git commit -m "plexus: re-point wiki-origin consumers at todl WikiLocator (Wave 2)"
```

---

### Task 3: Verification gate (both repos)

**Files:** none.

- [ ] **Step 1: TODL** — `npm test` (all pass; +5 tests) and `npm run typecheck` (19 pre-existing, no net-new) in the worktree.
- [ ] **Step 2: Plexus** — after `npm run build:core`: `npm run typecheck` (0 errors) and `npm test` at the root (plexus-core, devUI, plexus app all green; no regressions).
- [ ] **Step 3: Browser-safe guard** — confirm the TODL `browser-safe-composition` guard still passes (WikiLocator adds no node edge). Record counts in the task report. No commit (verification only).

---

## Self-Review notes

- **Spec coverage:** §1 (moved unit) → Task 1; §2 (Plexus re-point) → Task 2; §3 (testing) → Tasks 1–3; §4 (rollout) → this branch `wave2-wiki-origin`.
- **Type consistency:** `WikiLocator.LocateFile(packagesStorage, origin, relPath): { storage; path }`, `PackageOrigin(id, version)` (no kind/backend), `WikiOrigin` Package variant `{ kind; id; version }` — used identically across Tasks 1–2. The dropped `backend` field is removed at every producer (workspace-base-resolver) and every test fixture (arch-navigation, workspace-base-resolver, arch-model-wiki-origin).
- **Review Focus:** package-path (T1 step 1 last test), open-project (T1 step 1 fourth test), backend-removal-no-behavior-change (T2 steps 2/6 + step 7 suites), browser-safe (T3 step 3).
