# Solution concept + SolutionManager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Solution** (a logical grouping of several projects + a holder for cross-project settings) with a **SolutionManager** that owns one active solution at a time, opens all its member projects, and persists to `solution.json` — implemented in `@pragmatic-tech-ai/todl`, on a storage subsystem relocated to `@pragmatic-tech-ai/todl-runtime`, referenced by the TODL host app; Mural untouched.

**Architecture:** Bottom-up across four repos. The zero-dep `todl-runtime` gains the relocated `IStorage` IO subsystem. Mural re-exports it (no feature code). Plexus + the `todl` package re-point their storage imports. The `todl` package then implements all solution logic in TypeScript (unit-tested against `FakeStorage` + a `FakeProjectFactory`) and declares a Mural `SolutionModule`. The TODL host app registers a real `todl-package` project factory + a local storage backend, contributes the `npm-registry` setting bag, and references `SolutionModule` from `app.mu`.

**Tech Stack:** TypeScript (ESM, NodeNext), `tsx --test` (node:test), Mural (`ServiceBase`, `MuralBase`/`Observable`, `ObservableCollection`, `ProjectFactoryRegistry`, `SettingDefinition`/`SettingKind`, `PropertyGrid`), `vitePluginMural` for `.mu` in the app, Electron/electron-vite (app only).

**Spec:** `TODL/docs/superpowers/specs/2026-09-10-solution-manager-design.md` (also Project Spec item `PVTI_lADOE0Zc984Biu4ozg6ZIVA`). The plan argues from the spec; executors read both.

## Global Constraints

- **Layering (fixed):** `todl-runtime` = relocated IO subsystem ONLY (zero-dep). `mural` = NOTHING added (only re-exports storage). `@pragmatic-tech-ai/todl` = implements all solution logic + declares the module; **depends on `@pragmatic-tech-ai/mural` and `@pragmatic-tech-ai/todl-runtime`** (this consciously reverses the prior "TODL stands alone" rule; acyclic because Mural depends only on `todl-runtime`, never on `@pragmatic-tech-ai/todl`). TODL host app references the module.
- **OOP, no globals:** every function is a class method or `static` member; no module-level free functions or mutable module-level state. Module-level `const` for true constants and `type`/`enum`/`interface` decls is fine. (Note: the existing `storage.ts`/`fake-storage.ts`/`copy-tree.ts` being moved use module-level `function`s and a free `copyTree` — preserve them verbatim during the MOVE, do not rewrite; the no-globals rule binds NEW solution code.)
- **VMs extend `Observable`** (from `todl-runtime`), not `MuralBase`, unless the type genuinely needs the DP system. Services extend `ServiceBase`.
- **Enums over string-literal unions:** real `enum`s (mirroring `SettingKind`, `PropertyKind`).
- **Tests live in a `tests/` subfolder** next to the source. Framework: `tsx --conditions=development --test --test-force-exit "<glob>"`.
- **Markup-facing controls/enums/VMs** used in `.mu` must be registered in the owning compiler's symbol table and their templates merged (the PropertyGrid reference pattern).
- **Security:** `solution.json` NEVER stores a literal registry token — only `tokenSource`/`tokenEnvVar`. The `npm-registry` bag schema has no token-literal field.
- **Commit trailer:** every commit message ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Do NOT push or use `--no-verify` unless the user asks.
- **Manifest primitives only:** persisted setting values are `string`/`number`/`boolean` (the `ApplicationSettings.toStorable` lowering); no live objects.

---

## File Structure

**`todl-runtime`** (repo `todl-runtime/`):
- Create `src/storage/storage.ts` — `IStorage`, `StorageEntry`, `ILocalFileAccess`, `isLocalFileAccess`, `compareStorageEntries` (moved verbatim).
- Create `src/storage/fake-storage.ts` — `FakeStorage` (moved verbatim).
- Create `src/storage/copy-tree.ts` — `copyTree` (moved verbatim).
- Create `src/storage/tests/*.test.ts` — moved storage tests.
- Modify `src/index.ts` — add storage re-exports.

**`mural`** (repo `Mural/`):
- Modify `src/runtime/index.ts` (or the nearest re-export barrel) — re-export the storage surface from `@pragmatic-tech-ai/todl-runtime`.
- Modify `package.json` — bump the `@pragmatic-tech-ai/todl-runtime` dependency floor.

**`Plexus`** (repo `Plexus/`):
- Delete `src/renderer/src/services/storage/{storage.ts,copy-tree.ts,tests/fake-storage.ts,tests/copy-tree.test.ts,tests/compare-storage-entries.test.ts}` (moved).
- Modify `src/renderer/src/services/storage/{local-file-storage.ts,storage-provider-registry.ts,storage-package-sink.ts}` + ~40 consumer files — re-point `IStorage`/`StorageEntry`/`FakeStorage`/`copyTree`/`compareStorageEntries` imports to `@pragmatic-tech-ai/todl-runtime`.

**`@pragmatic-tech-ai/todl`** (repo `TODL/`, package root `TODL/`):
- Modify `package.json` — add `@pragmatic-tech-ai/mural` (`file:../Mural`) + `@pragmatic-tech-ai/todl-runtime` deps.
- Create `src/solution/solution-member-ref.ts` — `SolutionMemberRef` type + POSIX path helpers (as a class with statics).
- Create `src/solution/solution-manifest.ts` — `SolutionManifest` (parse/stringify).
- Create `src/solution/solution-member.ts` — `SolutionMember` (Observable).
- Create `src/solution/solution-session.ts` — `SolutionSession` (Observable).
- Create `src/solution/project-factory.ts` — `IProjectFactory` consumer contract (minimal).
- Create `src/solution/solution-manager-service.ts` — `SolutionManagerService` (ServiceBase).
- Create `src/solution/setting-bag-definition.ts` — `SettingBagDefinition`.
- Create `src/solution/solution-settings-registry.ts` — `SolutionSettingsRegistry` (ServiceBase).
- Create `src/solution/solution-setting-bag.ts` — `SolutionSettingBag` (live values + schema).
- Create `src/solution/setting-bag-grid.ts` — `SettingBagGrid` adapter (SettingKind→PropertyKind, MapPropertyBag).
- Create `src/solution/solution-tree-vm.ts` — `SolutionTreeVM` + `SolutionNodeVM` (folder tree).
- Create `src/solution/solution.module.mu` — the `SolutionModule` declaration.
- Create `src/solution/solution.resources.mu` — view templates (side pane, tree, settings pane).
- Create `src/solution/tests/*.test.ts` — unit tests + `fake-project-factory.ts`.
- Modify `src/index.ts` (package barrel) — export the solution public surface.
- Modify the package's symbol-table contribution (if the `todl` package owns one) OR document that markup registration happens in the app; see Task 16.

**TODL host app** (`TODL/app/`):
- Create `src/renderer/services/storage/app-local-storage.ts` — `AppLocalStorage implements IStorage, ILocalFileAccess` over the app's fs IPC bridge.
- Create `src/renderer/services/storage/storage-provider-registry.ts` OR reuse: register `'local'` backend.
- Create `src/renderer/modules/solution/todl-package-project-factory.ts` — real `todl-package` `IProjectFactory`.
- Create `src/renderer/modules/solution/npm-registry-bag.ts` — contributes the `npm-registry` `SettingBagDefinition`.
- Modify `src/renderer/app.mu` — add `SolutionModule` to `.modules:`.
- Create `src/renderer/modules/solution/tests/*.test.ts` + a Playwright e2e.

---

# PHASE 1 — Relocate the storage subsystem into `todl-runtime`

> Working directory for Phase 1: `todl-runtime/`. Test command: `npm test` (i.e. `tsx --conditions=development --test "src/**/*.test.ts"`). Build: `npm run build`. These files move VERBATIM — do not rewrite them to satisfy the no-globals rule; they are pre-existing infrastructure.

### Task 1: Move `IStorage` + helpers into `todl-runtime`

**Files:**
- Create: `todl-runtime/src/storage/storage.ts`
- Create: `todl-runtime/src/storage/tests/compare-storage-entries.test.ts`
- Modify: `todl-runtime/src/index.ts`

**Interfaces:**
- Produces: `IStorage`, `StorageEntry`, `ILocalFileAccess`, `isLocalFileAccess(storage): storage is IStorage & ILocalFileAccess`, `compareStorageEntries(a, b): number` — exported from `@pragmatic-tech-ai/todl-runtime`.

- [ ] **Step 1: Copy the source verbatim.** Copy `Plexus/src/renderer/src/services/storage/storage.ts` to `todl-runtime/src/storage/storage.ts` unchanged (it is already node-free; keep its module-level `compareStorageEntries` function as-is). Remove the doc-comment line that references the Plexus design-spec path; leave the rest.

- [ ] **Step 2: Copy the test verbatim.** Copy `Plexus/src/renderer/src/services/storage/tests/compare-storage-entries.test.ts` to `todl-runtime/src/storage/tests/compare-storage-entries.test.ts`; fix the relative import to `../storage.js`.

- [ ] **Step 3: Re-export from the package index.** In `todl-runtime/src/index.ts`, add:

```ts
export {
    type IStorage,
    type StorageEntry,
    type ILocalFileAccess,
    isLocalFileAccess,
    compareStorageEntries,
} from './storage/storage.js'
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `cd todl-runtime && npm test`
Expected: PASS (the moved `compare-storage-entries` test), plus the pre-existing `observable.test.ts` still green.

- [ ] **Step 5: Typecheck + build.**

Run: `cd todl-runtime && npm run typecheck && npm run build`
Expected: clean; `dist/storage/storage.js` + `dist/index.d.ts` include the storage exports.

- [ ] **Step 6: Commit.**

```bash
git -C todl-runtime add -A
git -C todl-runtime commit -m "feat(storage): relocate IStorage contract into todl-runtime

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 2: Move `FakeStorage`

**Files:**
- Create: `todl-runtime/src/storage/fake-storage.ts`
- Create: `todl-runtime/src/storage/tests/fake-storage.test.ts`
- Modify: `todl-runtime/src/index.ts`

**Interfaces:**
- Consumes: `IStorage`, `StorageEntry` (Task 1).
- Produces: `FakeStorage` (an in-memory `IStorage`, `new FakeStorage(root='fake://project')`, plus a `get size`) — exported from `@pragmatic-tech-ai/todl-runtime`.

- [ ] **Step 1: Copy the source verbatim.** Copy `Plexus/.../storage/tests/fake-storage.ts` to `todl-runtime/src/storage/fake-storage.ts`; change its import to `import type { IStorage, StorageEntry } from './storage.js'`. Keep its module-level `normalize`/`parentOf` helpers verbatim (moved infrastructure).

- [ ] **Step 2: Write a failing smoke test.** `todl-runtime/src/storage/tests/fake-storage.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '../fake-storage.js'

test('FakeStorage round-trips text and lists a directory', async () => {
    const s = new FakeStorage()
    await s.WriteText('a/b.txt', 'hi')
    assert.equal(await s.ReadText('a/b.txt'), 'hi')
    const entries = await s.List('a')
    assert.deepEqual([...entries], [{ Name: 'b.txt', IsDirectory: false }])
})

test('FakeStorage Delete removes a subtree', async () => {
    const s = new FakeStorage()
    await s.WriteText('d/x', '1'); await s.WriteText('d/e/y', '2')
    await s.Delete('d')
    assert.equal(await s.Exists('d/x'), false)
    assert.equal(await s.Exists('d/e/y'), false)
})
```

- [ ] **Step 3: Run it to verify it fails.** Run: `cd todl-runtime && npx tsx --conditions=development --test "src/storage/tests/fake-storage.test.ts"` — Expected: FAIL ("Cannot find module '../fake-storage.js'") if Step 1 not saved, else PASS. (If it already passes because Step 1 is done, that is acceptable — this is a moved implementation, not new TDD.)

- [ ] **Step 4: Export `FakeStorage`.** Add to `todl-runtime/src/index.ts`: `export { FakeStorage } from './storage/fake-storage.js'`.

- [ ] **Step 5: Run tests + typecheck.** Run: `cd todl-runtime && npm test && npm run typecheck` — Expected: PASS/clean.

- [ ] **Step 6: Commit.**

```bash
git -C todl-runtime add -A
git -C todl-runtime commit -m "feat(storage): add in-memory FakeStorage to todl-runtime

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 3: Move `copyTree`

**Files:**
- Create: `todl-runtime/src/storage/copy-tree.ts`
- Create: `todl-runtime/src/storage/tests/copy-tree.test.ts`
- Modify: `todl-runtime/src/index.ts`

**Interfaces:**
- Consumes: `IStorage` (Task 1), `FakeStorage` (Task 2, in tests).
- Produces: `copyTree(src: IStorage, srcPath: string, dst: IStorage, dstPath: string, isDirectory: boolean): Promise<void>` — exported from `@pragmatic-tech-ai/todl-runtime`.

- [ ] **Step 1: Copy source + test verbatim.** Copy `copy-tree.ts` → `todl-runtime/src/storage/copy-tree.ts` (import `./storage.js`); copy `tests/copy-tree.test.ts` → `todl-runtime/src/storage/tests/copy-tree.test.ts`, fixing imports to `../copy-tree.js` and `../fake-storage.js`.

- [ ] **Step 2: Export.** Add to `src/index.ts`: `export { copyTree } from './storage/copy-tree.js'`.

- [ ] **Step 3: Run tests + typecheck + build.** Run: `cd todl-runtime && npm test && npm run typecheck && npm run build` — Expected: PASS/clean.

- [ ] **Step 4: Commit.**

```bash
git -C todl-runtime add -A
git -C todl-runtime commit -m "feat(storage): add copyTree to todl-runtime

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 4: Bump + publish-prep `todl-runtime`

**Files:**
- Modify: `todl-runtime/package.json` (version)

- [ ] **Step 1: Bump the minor version.** In `todl-runtime/package.json`, `0.1.0` → `0.2.0` (new public surface).

- [ ] **Step 2: Clean build + full test.** Run: `cd todl-runtime && npm run clean && npm run build && npm test` — Expected: clean build, all tests pass.

- [ ] **Step 3: Make available to local consumers.** This repo set uses `file:` links (see the app's `@pragmatic-tech-ai/mural: file:../../Mural`). Confirm how Mural consumes `todl-runtime` (`git -C Mural show HEAD:package.json | grep todl-runtime` shows `^0.1.0`). If it is an npm-registry dependency, publish: `cd todl-runtime && npm publish`. If it is a local `file:`/workspace link, no publish is needed — the version bump + build is enough. **Record which it is in the commit body.**

- [ ] **Step 4: Commit.**

```bash
git -C todl-runtime add -A
git -C todl-runtime commit -m "chore(todl-runtime): 0.2.0 — storage subsystem

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# PHASE 2 — Mural re-exports the storage surface (no feature code)

> Working directory: `Mural/`. Build: `npm run build`. Typecheck: `npm run typecheck`. Test: `npm test`.

### Task 5: Re-export storage from Mural, bump the todl-runtime floor

**Files:**
- Modify: `Mural/src/runtime/index.ts`
- Modify: `Mural/package.json`

**Interfaces:**
- Produces: `IStorage`, `StorageEntry`, `ILocalFileAccess`, `isLocalFileAccess`, `compareStorageEntries`, `FakeStorage`, `copyTree` re-exported from `@pragmatic-tech-ai/mural/runtime` (convenience for consumers already importing that subpath).

- [ ] **Step 1: Bump the dependency floor.** In `Mural/package.json`, set `@pragmatic-tech-ai/todl-runtime` to `^0.2.0`. If Mural consumes it via `file:` link, run `npm install` in `Mural/` to refresh; do NOT hand-edit the lockfile.

- [ ] **Step 2: Add the re-export.** In `Mural/src/runtime/index.ts`, append:

```ts
// Storage IO subsystem lives in todl-runtime (zero-dep); re-exported here so
// consumers already importing '@pragmatic-tech-ai/mural/runtime' need no second
// import path. Canonical source: @pragmatic-tech-ai/todl-runtime.
export {
    type IStorage, type StorageEntry, type ILocalFileAccess,
    isLocalFileAccess, compareStorageEntries, FakeStorage, copyTree,
} from '@pragmatic-tech-ai/todl-runtime'
```

- [ ] **Step 2b: Verify the export barrel.** Confirm `src/runtime/index.ts` is the barrel behind the `./runtime` export (it is per `package.json`). If Mural prefers a different re-export location, follow the file that already re-exports `Observable` from todl-runtime (`grep -rn "todl-runtime" Mural/src`).

- [ ] **Step 3: Typecheck + build + test.** Run: `cd Mural && npm run typecheck && npm run build && npm test` — Expected: clean; full suite green (no feature code added, so any failure is an integration/link problem — fix the link, not tests).

- [ ] **Step 4: Commit.**

```bash
git -C Mural add -A
git -C Mural commit -m "chore(runtime): re-export todl-runtime storage subsystem

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# PHASE 3 — Plexus + `todl` re-point storage imports

> Two independent consumers. Do Plexus (Task 6) and the todl package (Task 7) as separate commits. Each must build + test green.

### Task 6: Plexus re-points to `todl-runtime`, deletes moved files

**Files:**
- Delete: `Plexus/src/renderer/src/services/storage/storage.ts`, `copy-tree.ts`, `tests/fake-storage.ts`, `tests/copy-tree.test.ts`, `tests/compare-storage-entries.test.ts`
- Modify: `local-file-storage.ts`, `storage-provider-registry.ts`, `storage-package-sink.ts` + all consumers (~40 files) — re-point imports.

**Interfaces:**
- Consumes: the storage surface from `@pragmatic-tech-ai/todl-runtime` (or via `@pragmatic-tech-ai/mural/runtime`).

- [ ] **Step 1: Bump Plexus's todl-runtime floor if it declares one.** `grep -n "todl-runtime" Plexus/package.json`; if present, set `^0.2.0` and `npm install`. If Plexus gets it transitively through Mural, skip.

- [ ] **Step 2: Re-point imports.** Replace every `from '.../services/storage/storage.js'` (and `copy-tree.js`, `tests/fake-storage.js`) across `Plexus/src` with `from '@pragmatic-tech-ai/todl-runtime'`. Enumerate first: `grep -rln "services/storage/storage\|services/storage/copy-tree\|storage/tests/fake-storage" Plexus/src`. For `local-file-storage.ts`, `storage-provider-registry.ts`, and `storage-package-sink.ts`, change only the `IStorage`/`StorageEntry`/`ILocalFileAccess` type import line to `@pragmatic-tech-ai/todl-runtime` (they keep their host deps: `FileSystemService`, `@pragmatic-tech-ai/todl`). Do the replacement with individual edits, not a blind `sed` (the repo's republish gotchas note `sed` can corrupt files/lockfiles).

- [ ] **Step 3: Delete the moved files.** Remove the five files listed above. Keep `local-file-storage.ts`, `storage-provider-registry.ts`, `storage-package-sink.ts`, and any Plexus-only tests for those.

- [ ] **Step 4: Typecheck + build + full test.** Run: `cd Plexus && npm run typecheck && npm run build && npm test` (use Plexus's actual script names — `grep '"' Plexus/package.json` under `scripts`). Expected: green. Any `Cannot find module './storage.js'` means a missed consumer — re-point it.

- [ ] **Step 5: Commit.**

```bash
git -C Plexus add -A
git -C Plexus commit -m "refactor(storage): consume IStorage from todl-runtime; drop local copy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Note / deviation from spec:** the spec suggested `storage-package-sink.ts` "lands in the todl package." To minimize churn it STAYS in Plexus here, only re-pointing its `IStorage` import; moving it is a low-value follow-up. Flag this to the reviewer; do not block on it.

### Task 7: `todl` package gains Mural + todl-runtime deps

**Files:**
- Modify: `TODL/package.json`

**Interfaces:**
- Produces: `@pragmatic-tech-ai/todl` now depends on `@pragmatic-tech-ai/mural` and `@pragmatic-tech-ai/todl-runtime` (prerequisite for all Phase-4 tasks).

- [ ] **Step 1: Add dependencies.** In `TODL/package.json` `dependencies`, add `"@pragmatic-tech-ai/mural": "file:../Mural"` and `"@pragmatic-tech-ai/todl-runtime": "^0.2.0"`. (Match the app's `file:` convention for Mural: the app uses `file:../../Mural`; from `TODL/` the relative path is `file:../Mural` — verify with `ls TODL/../Mural/package.json`.)

- [ ] **Step 2: Install.** Run: `cd TODL && npm install` — Expected: resolves without a cycle (Mural must NOT depend on `@pragmatic-tech-ai/todl`; confirm with `grep '@pragmatic-tech-ai/todl"' Mural/package.json` returns nothing).

- [ ] **Step 3: Sanity import.** Add a temporary `src/solution/_probe.ts` that does `import { ServiceBase } from '@pragmatic-tech-ai/mural/runtime'; import { IStorage } from '@pragmatic-tech-ai/todl-runtime'` and references both in a throwaway `export const _ok = (s: IStorage) => s.Root`. Run `cd TODL && npm run typecheck` (or `npx tsc --noEmit`) — Expected: clean. Delete `_probe.ts`.

- [ ] **Step 4: Commit.**

```bash
git -C TODL add -A
git -C TODL commit -m "chore(todl): depend on mural + todl-runtime (solution feature prep)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# PHASE 4 — Solution machinery in `@pragmatic-tech-ai/todl`

> Working directory: `TODL/`. Test command: `npx tsx --conditions=development --test --test-force-exit "src/solution/tests/*.test.ts"`. Typecheck: `npx tsc --noEmit`. All Phase-4 unit tests use `FakeStorage` + `FakeProjectFactory` — no Electron, no `.mu`.

### Task 8: `SolutionMemberRef` + `SolutionManifest`

**Files:**
- Create: `TODL/src/solution/solution-member-ref.ts`
- Create: `TODL/src/solution/solution-manifest.ts`
- Test: `TODL/src/solution/tests/solution-manifest.test.ts`

**Interfaces:**
- Produces:
  - `interface SolutionMemberRef { path: string; type: string }` (path is POSIX, relative).
  - `class SolutionPath { static toPosix(p: string): string; static isRelative(p: string): boolean }`.
  - `class SolutionManifest` with `readonly name: string; readonly members: SolutionMemberRef[]; readonly settings: Record<string, Record<string, string|number|boolean>>` and `static parse(text: string): SolutionManifest`, `stringify(): string`, `static create(name: string): SolutionManifest`. `parse` throws `Error` on wrong `kind` or a `version` major > 1.
- Consumes: nothing.

- [ ] **Step 1: Write failing tests.** `tests/solution-manifest.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SolutionManifest } from '../solution-manifest.js'

const SAMPLE = JSON.stringify({
    kind: 'todl-solution', version: 1, name: 'My Solution',
    members: [{ path: './api', type: 'architecture' }, { path: '../lib', type: 'library' }],
    settings: { 'npm-registry': { registry: 'https://x', org: 'acme' } },
})

test('parse → stringify round-trips (stable)', () => {
    const m = SolutionManifest.parse(SAMPLE)
    assert.equal(m.name, 'My Solution')
    assert.equal(m.members.length, 2)
    assert.equal(m.members[0].path, './api')
    assert.deepEqual(m.settings['npm-registry'], { registry: 'https://x', org: 'acme' })
    // round-trip preserves content
    assert.deepEqual(JSON.parse(m.stringify()), JSON.parse(SAMPLE))
})

test('unknown member type is preserved, not dropped', () => {
    const m = SolutionManifest.parse(JSON.stringify({
        kind: 'todl-solution', version: 1, name: 'S',
        members: [{ path: './x', type: 'not-installed' }], settings: {},
    }))
    assert.equal(m.members[0].type, 'not-installed')
    assert.match(m.stringify(), /not-installed/)
})

test('wrong kind throws', () => {
    assert.throws(() => SolutionManifest.parse(JSON.stringify({ kind: 'nope', version: 1 })), /kind/)
})

test('future major version is rejected', () => {
    assert.throws(() => SolutionManifest.parse(JSON.stringify({ kind: 'todl-solution', version: 2 })), /newer version/)
})

test('paths normalize to POSIX on stringify', () => {
    const m = SolutionManifest.parse(JSON.stringify({
        kind: 'todl-solution', version: 1, name: 'S',
        members: [{ path: '.\\api\\sub', type: 'architecture' }], settings: {},
    }))
    assert.match(m.stringify(), /\.\/api\/sub|api\/sub/)
    assert.doesNotMatch(m.stringify(), /\\\\/)
})
```

- [ ] **Step 2: Run to verify failure.** Run: `cd TODL && npx tsx --conditions=development --test "src/solution/tests/solution-manifest.test.ts"` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `solution-member-ref.ts`.**

```ts
// A member project's manifest entry: a relative POSIX path + its project type id.
export interface SolutionMemberRef {
    path: string
    type: string
}

// Path helpers as static methods (no module-level free functions).
export class SolutionPath {
    static toPosix(p: string): string {
        return p.split(/[\\/]+/).filter((s) => s.length > 0).join('/')
            // preserve a leading ./ or ../ prefix intent
            .replace(/^(\.\.?)(?=\/|$)/, '$1')
    }
    static isRelative(p: string): boolean {
        return !/^([a-zA-Z]:[\\/]|[\\/])/.test(p)
    }
}
```

  (Keep `toPosix` faithful: it must turn `.\api\sub` into `api/sub` or `./api/sub` and never emit backslashes. If preserving the exact `./` prefix is awkward, normalize to a clean relative POSIX path without a leading `./` — the test's regex accepts either form.)

- [ ] **Step 4: Implement `solution-manifest.ts`.**

```ts
import { SolutionMemberRef, SolutionPath } from './solution-member-ref.js'

type SettingValues = Record<string, string | number | boolean>

export class SolutionManifest {
    static readonly KIND = 'todl-solution'
    static readonly VERSION = 1

    constructor(
        public readonly name: string,
        public readonly members: SolutionMemberRef[],
        public readonly settings: Record<string, SettingValues>,
    ) {}

    static create(name: string): SolutionManifest {
        return new SolutionManifest(name, [], {})
    }

    static parse(text: string): SolutionManifest {
        const raw = JSON.parse(text) as Record<string, unknown>
        if (raw.kind !== SolutionManifest.KIND) throw new Error(`Not a solution file (kind="${String(raw.kind)}").`)
        const version = typeof raw.version === 'number' ? raw.version : 0
        if (version > SolutionManifest.VERSION) throw new Error('Solution was made by a newer version of the app.')
        const name = typeof raw.name === 'string' ? raw.name : 'Solution'
        const members: SolutionMemberRef[] = Array.isArray(raw.members)
            ? raw.members.map((m) => {
                const mm = m as Record<string, unknown>
                return { path: SolutionPath.toPosix(String(mm.path ?? '')), type: String(mm.type ?? '') }
              })
            : []
        const settings = (raw.settings && typeof raw.settings === 'object')
            ? raw.settings as Record<string, SettingValues>
            : {}
        return new SolutionManifest(name, members, settings)
    }

    stringify(): string {
        return JSON.stringify({
            kind: SolutionManifest.KIND,
            version: SolutionManifest.VERSION,
            name: this.name,
            members: this.members.map((m) => ({ path: SolutionPath.toPosix(m.path), type: m.type })),
            settings: this.settings,
        }, null, 2)
    }
}
```

- [ ] **Step 5: Run tests to verify pass.** Run the Step-2 command — Expected: PASS (all 5).

- [ ] **Step 6: Commit.**

```bash
git -C TODL add -A
git -C TODL commit -m "feat(solution): SolutionManifest parse/stringify + member refs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 9: `SolutionMember` + `SolutionSession`

**Files:**
- Create: `TODL/src/solution/solution-member.ts`
- Create: `TODL/src/solution/solution-session.ts`
- Test: `TODL/src/solution/tests/solution-session.test.ts`

**Interfaces:**
- Consumes: `Observable` (`@pragmatic-tech-ai/todl-runtime`), `ObservableCollection` (`@pragmatic-tech-ai/mural/runtime`), `IStorage` (`@pragmatic-tech-ai/todl-runtime`), `SolutionMemberRef` (Task 8).
- Produces:
  - `class SolutionMember extends Observable { readonly Ref: SolutionMemberRef; Project: unknown | undefined; Title: string }`.
  - `class SolutionSession extends Observable { Name: string; readonly Storage: IStorage; readonly Members: ObservableCollection<SolutionMember>; readonly SettingBags: ObservableCollection<SolutionSettingBag>; IsDirty: boolean; AddMember(path: string, type: string): SolutionMember; RemoveMember(m: SolutionMember): void; SetSettingValue(bagId, key, value): void }`. (Note: `SolutionSettingBag` type is defined in Task 13; for Task 9 keep `SettingBags` typed as `ObservableCollection<SolutionSettingBag>` via a forward import — implement `SolutionSettingBag` skeleton here if Task 13 not yet done, or land Task 9's `SettingBags` as an empty collection and enrich in Task 13. To avoid a forward dependency, Task 9 declares `SettingBags` but does not populate it.)

- [ ] **Step 1: Write failing tests.** `tests/solution-session.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionSession } from '../solution-session.js'

test('AddMember appends and marks dirty', () => {
    const s = new SolutionSession('S', new FakeStorage())
    assert.equal(s.IsDirty, false)
    const m = s.AddMember('./api', 'architecture')
    assert.equal(s.Members.Count ?? s.Members.length, 1)   // use the collection's real count accessor
    assert.equal(m.Ref.path, './api')
    assert.equal(s.IsDirty, true)
})

test('RemoveMember drops it and marks dirty', () => {
    const s = new SolutionSession('S', new FakeStorage())
    const m = s.AddMember('./api', 'architecture')
    s.IsDirty = false
    s.RemoveMember(m)
    assert.equal(s.Members.Count ?? s.Members.length, 0)
    assert.equal(s.IsDirty, true)
})

test('setting Name raises PropertyChanged', () => {
    const s = new SolutionSession('S', new FakeStorage())
    let fired = false
    s.AddPropertyChangedListener('Name', () => { fired = true })
    s.Name = 'Renamed'
    assert.equal(fired, true)
})
```

- [ ] **Step 2: Confirm the `ObservableCollection` count accessor + `Observable` API.** Run: `grep -n "get Count\|get length\|Add(\|Remove(" Mural/src/runtime/*collection*.ts` and `grep -n "RaisePropertyChanged\|AddPropertyChangedListener" todl-runtime/src/observable.ts`. Use the real names in the implementation (`Observable.RaisePropertyChanged(name, old, next)` per the memory; `ObservableCollection.Add/Remove/Count`). Fix the test's count accessor to the real one.

- [ ] **Step 3: Run to verify failure.** Run: `cd TODL && npx tsx --conditions=development --test "src/solution/tests/solution-session.test.ts"` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `solution-member.ts`.**

```ts
import { Observable } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionMemberRef } from './solution-member-ref.js'

export class SolutionMember extends Observable {
    public readonly Ref: SolutionMemberRef
    private _project: unknown | undefined
    private _title: string

    constructor(ref: SolutionMemberRef) {
        super()
        this.Ref = ref
        this._title = ref.path
    }

    public get Project(): unknown | undefined { return this._project }
    public set Project(v: unknown | undefined) { const old = this._project; this._project = v; this.RaisePropertyChanged('Project', old, v) }

    public get Title(): string { return this._title }
    public set Title(v: string) { const old = this._title; this._title = v; this.RaisePropertyChanged('Title', old, v) }

    // A member with a resolved project handle; false ⇒ unresolved (broken ref).
    public get IsResolved(): boolean { return this._project !== undefined }
}
```

- [ ] **Step 5: Implement `solution-session.ts`.**

```ts
import { Observable } from '@pragmatic-tech-ai/todl-runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { SolutionMember } from './solution-member.js'
import type { SolutionSettingBag } from './solution-setting-bag.js'

export class SolutionSession extends Observable {
    private _name: string
    private _dirty = false
    public readonly Storage: IStorage
    public readonly Members = new ObservableCollection<SolutionMember>()
    public readonly SettingBags = new ObservableCollection<SolutionSettingBag>()

    constructor(name: string, storage: IStorage) {
        super()
        this._name = name
        this.Storage = storage
    }

    public get Name(): string { return this._name }
    public set Name(v: string) { const old = this._name; this._name = v; this.RaisePropertyChanged('Name', old, v); this.markDirty() }

    public get IsDirty(): boolean { return this._dirty }
    public set IsDirty(v: boolean) { const old = this._dirty; this._dirty = v; this.RaisePropertyChanged('IsDirty', old, v) }

    public AddMember(path: string, type: string): SolutionMember {
        const member = new SolutionMember({ path, type })
        this.Members.Add(member)
        this.markDirty()
        return member
    }

    public RemoveMember(member: SolutionMember): void {
        this.Members.Remove(member)
        this.markDirty()
    }

    private markDirty(): void { if (!this._dirty) this.IsDirty = true }
}
```

  (If `Task 13`'s `solution-setting-bag.ts` does not exist yet, create a minimal stub `export class SolutionSettingBag {}` so this compiles; Task 13 fleshes it out.)

- [ ] **Step 6: Run tests + typecheck.** Run the Step-3 command + `npx tsc --noEmit` — Expected: PASS/clean.

- [ ] **Step 7: Commit.**

```bash
git -C TODL add -A
git -C TODL commit -m "feat(solution): SolutionSession + SolutionMember with dirty tracking

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 10: `IProjectFactory` + `FakeProjectFactory` + open-all resolution

**Files:**
- Create: `TODL/src/solution/project-factory.ts`
- Create: `TODL/src/solution/tests/fake-project-factory.ts`
- Create/Modify: open-all logic on `SolutionSession` or a `SolutionOpener` helper — put it as a method `SolutionSession.OpenMembers(resolve)` to keep it testable without Mural's registry.
- Test: `TODL/src/solution/tests/open-members.test.ts`

**Interfaces:**
- Produces:
  - `interface IProjectFactory { openProject(storage: IStorage): Promise<unknown>; createProject(storage: IStorage, name: string): Promise<unknown>; saveProject(project: unknown, storage: IStorage): Promise<void> }`.
  - `type MemberStorageResolver = (relpath: string) => IStorage` and `type ProjectFactoryResolver = (typeId: string) => IProjectFactory | undefined`.
  - `SolutionSession.OpenMembers(storageFor: MemberStorageResolver, factoryFor: ProjectFactoryResolver): Promise<void>` — for each member, resolves storage + factory, calls `openProject`, sets `member.Project`; a member whose factory is missing stays unresolved (`Project` undefined), no throw.
- Consumes: `IStorage`, `SolutionMember`.

- [ ] **Step 1: Write failing tests.** `tests/open-members.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionSession } from '../solution-session.js'
import { FakeProjectFactory } from './fake-project-factory.js'

test('OpenMembers resolves known types, leaves unknown unresolved', async () => {
    const s = new SolutionSession('S', new FakeStorage())
    s.AddMember('./api', 'architecture')
    s.AddMember('./x', 'not-installed')
    const arch = new FakeProjectFactory()
    await s.OpenMembers(
        () => new FakeStorage(),
        (type) => (type === 'architecture' ? arch : undefined),
    )
    const [m0, m1] = [...s.Members]   // ObservableCollection is iterable
    assert.equal(m0.IsResolved, true)
    assert.equal(m1.IsResolved, false)
    assert.equal(arch.openCount, 1)
})
```

- [ ] **Step 2: Confirm `ObservableCollection` iteration.** `grep -n "Symbol.iterator\|\\[Symbol" Mural/src/runtime/*collection*.ts`. If it is not iterable, use its indexer/`ToArray()`; fix the test accordingly.

- [ ] **Step 3: Run to verify failure.** Run: `cd TODL && npx tsx --conditions=development --test "src/solution/tests/open-members.test.ts"` — Expected: FAIL.

- [ ] **Step 4: Implement `project-factory.ts`.**

```ts
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// Consumer-side project factory contract (minimal): opens/creates/saves a
// project rooted at an IStorage. A host registers concrete factories against
// project type ids via Mural's ProjectFactoryRegistry; the solution machinery
// only needs these three verbs.
export interface IProjectFactory {
    openProject(storage: IStorage): Promise<unknown>
    createProject(storage: IStorage, name: string): Promise<unknown>
    saveProject(project: unknown, storage: IStorage): Promise<void>
}

export type MemberStorageResolver = (relpath: string) => IStorage
export type ProjectFactoryResolver = (typeId: string) => IProjectFactory | undefined
```

- [ ] **Step 5: Implement `fake-project-factory.ts`.**

```ts
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { IProjectFactory } from '../project-factory.js'

export class FakeProjectFactory implements IProjectFactory {
    public openCount = 0
    public saveCount = 0
    async openProject(_s: IStorage): Promise<unknown> { this.openCount++; return { kind: 'fake' } }
    async createProject(_s: IStorage, name: string): Promise<unknown> { return { kind: 'fake', name } }
    async saveProject(_p: unknown, _s: IStorage): Promise<void> { this.saveCount++ }
}
```

- [ ] **Step 6: Add `OpenMembers` to `solution-session.ts`.**

```ts
import type { MemberStorageResolver, ProjectFactoryResolver } from './project-factory.js'
// ... inside SolutionSession:
public async OpenMembers(storageFor: MemberStorageResolver, factoryFor: ProjectFactoryResolver): Promise<void> {
    for (const member of this.Members) {              // adjust if not iterable (Step 2)
        const factory = factoryFor(member.Ref.type)
        if (factory === undefined) { member.Project = undefined; continue }
        member.Project = await factory.openProject(storageFor(member.Ref.path))
    }
}
```

- [ ] **Step 7: Run tests + typecheck.** Expected: PASS/clean.

- [ ] **Step 8: Commit.**

```bash
git -C TODL add -A
git -C TODL commit -m "feat(solution): open-all member resolution + IProjectFactory seam

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 11: `SolutionManagerService` (ServiceBase) lifecycle

**Files:**
- Create: `TODL/src/solution/solution-manager-service.ts`
- Test: `TODL/src/solution/tests/solution-manager-service.test.ts`

**Interfaces:**
- Consumes: `ServiceBase`, `ServiceKey`, `IServiceProvider`, `MuralBase`, `MetaData`, `ObservableCollection` (`@pragmatic-tech-ai/mural/runtime`); `ProjectFactoryRegistry` (`@pragmatic-tech-ai/mural/framework`); `SolutionSession`, `SolutionManifest`, `IProjectFactory` resolvers (earlier tasks). A `StorageProviderRegistry`-like resolver is injected as a function seam so this is testable without the host registry.
- Produces: `class SolutionManagerService extends ServiceBase implements IActivatable` with:
  - `static readonly Key`, DP `ActiveSolution: SolutionSession | undefined`, DP `RecentSolutions: ObservableCollection<string>`.
  - `NewSolution(location: string): Promise<void>`, `OpenSolution(location: string): Promise<void>`, `Save(): Promise<void>`, `SaveAs(location: string): Promise<void>`, `CloseSolution(): Promise<void>`, `OnActivated(): void`.
  - Two injected seams (set via a `Configure(...)` method the module wiring calls, so tests inject fakes): `storageForFolder: (folder: string) => IStorage` and the member `factoryFor`/`storageFor` (derived from `ProjectFactoryRegistry` + `storageForFolder` at runtime).

- [ ] **Step 1: Write failing tests** (inject fakes; no real container, no dialog):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionManagerService } from '../solution-manager-service.js'
import { FakeProjectFactory } from './fake-project-factory.js'

function makeService() {
    const roots = new Map<string, FakeStorage>()
    const svc = SolutionManagerService.createForTest({
        storageForFolder: (folder) => { const s = roots.get(folder) ?? new FakeStorage(folder); roots.set(folder, s); return s },
        factoryFor: (type) => (type === 'architecture' ? new FakeProjectFactory() : undefined),
        confirmDiscard: async () => true,     // stubbed save-prompt
    })
    return { svc, roots }
}

test('New → Save writes solution.json; Open reads it back with members', async () => {
    const { svc, roots } = makeService()
    await svc.NewSolution('/work/sol')
    svc.ActiveSolution!.Name = 'My Solution'
    svc.ActiveSolution!.AddMember('./api', 'architecture')
    await svc.Save()
    const stored = await roots.get('/work/sol')!.ReadText('solution.json')
    assert.match(stored, /todl-solution/)
    assert.match(stored, /\.\/api/)

    await svc.CloseSolution()
    assert.equal(svc.ActiveSolution, undefined)

    await svc.OpenSolution('/work/sol')
    assert.equal(svc.ActiveSolution!.Name, 'My Solution')
    assert.equal([...svc.ActiveSolution!.Members][0].IsResolved, true)
})

test('Save clears dirty; opening adds to RecentSolutions', async () => {
    const { svc } = makeService()
    await svc.NewSolution('/work/sol')
    svc.ActiveSolution!.AddMember('./a', 'architecture')
    assert.equal(svc.ActiveSolution!.IsDirty, true)
    await svc.Save()
    assert.equal(svc.ActiveSolution!.IsDirty, false)
    assert.ok([...svc.RecentSolutions].includes('/work/sol'))
})
```

- [ ] **Step 2: Confirm `ServiceBase`/`ServiceKey`/DP idioms.** Re-read `Mural/src/runtime/services/service-base.ts` and an example service's DP declaration (`Mural/src/framework/shell/projects/project-factory-registry.ts`). Confirm `MuralBase.RegisterProperty`, `set_property_value`/`get_property_value`, `new ServiceKey<T>('...')`, and `IActivatable` import path (`@pragmatic-tech-ai/mural/framework`). Confirm the constructor signature `constructor(provider: IServiceProvider)`.

- [ ] **Step 3: Run to verify failure.** Run: `cd TODL && npx tsx --conditions=development --test "src/solution/tests/solution-manager-service.test.ts"` — Expected: FAIL.

- [ ] **Step 4: Implement `solution-manager-service.ts`.** Key shape (fill DP boilerplate per Step 2):

```ts
import { ServiceBase, ServiceKey, MuralBase, MetaData, ObservableCollection, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { IActivatable } from '@pragmatic-tech-ai/mural/framework'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionSession } from './solution-session.js'
import { SolutionManifest } from './solution-manifest.js'
import type { IProjectFactory } from './project-factory.js'

interface SolutionSeams {
    storageForFolder: (folder: string) => IStorage
    factoryFor: (typeId: string) => IProjectFactory | undefined
    confirmDiscard: () => Promise<boolean>   // save-prompt when replacing a dirty solution
}

export class SolutionManagerService extends ServiceBase implements IActivatable {
    public static readonly Key = new ServiceKey<SolutionManagerService>('SolutionManager')
    public static readonly ActiveSolutionKey = MuralBase.RegisterProperty<SolutionSession | undefined>(
        SolutionManagerService, 'ActiveSolution', undefined, MetaData.None)
    public static readonly RecentSolutionsKey = MuralBase.RegisterProperty<ObservableCollection<string>>(
        SolutionManagerService, 'RecentSolutions', undefined as unknown as ObservableCollection<string>, MetaData.None)

    private seams: SolutionSeams

    constructor(provider: IServiceProvider) {
        super(provider)
        this.set_property_value(SolutionManagerService.RecentSolutionsKey, new ObservableCollection<string>())
        // real seams are installed by the module wiring via Configure(); default throws until then
        this.seams = SolutionManagerService.throwingSeams()
    }

    // Test seam constructor: bypasses the container, installs fakes directly.
    public static createForTest(seams: SolutionSeams): SolutionManagerService {
        const svc = new SolutionManagerService({ get: () => undefined, getRequired: () => { throw new Error('no container') } } as unknown as IServiceProvider)
        svc.seams = seams
        return svc
    }

    public Configure(seams: SolutionSeams): void { this.seams = seams }

    public get ActiveSolution(): SolutionSession | undefined { return this.get_property_value(SolutionManagerService.ActiveSolutionKey) }
    private setActive(s: SolutionSession | undefined): void { this.set_property_value(SolutionManagerService.ActiveSolutionKey, s) }
    public get RecentSolutions(): ObservableCollection<string> { return this.get_property_value(SolutionManagerService.RecentSolutionsKey) }

    public async NewSolution(location: string): Promise<void> {
        if (!(await this.canReplace())) return
        const storage = this.seams.storageForFolder(location)
        const session = new SolutionSession('Untitled Solution', storage)
        this.setActive(session)
    }

    public async OpenSolution(location: string): Promise<void> {
        if (!(await this.canReplace())) return
        const storage = this.seams.storageForFolder(location)
        const manifest = SolutionManifest.parse(await storage.ReadText('solution.json'))
        const session = new SolutionSession(manifest.name, storage)
        for (const ref of manifest.members) session.AddMember(ref.path, ref.type)
        // load persisted setting values into the session before opening members (Task 13 wires bags)
        session.LoadSettings(manifest.settings)
        await session.OpenMembers(
            (rel) => this.seams.storageForFolder(this.resolveMemberFolder(location, rel)),
            (type) => this.seams.factoryFor(type),
        )
        session.IsDirty = false
        this.setActive(session)
        this.pushRecent(location)
    }

    public async Save(): Promise<void> {
        const s = this.ActiveSolution; if (s === undefined) return
        const manifest = new SolutionManifest(s.Name, [...s.Members].map((m) => m.Ref), s.CollectSettings())
        await s.Storage.WriteText('solution.json', manifest.stringify())
        s.IsDirty = false
        this.pushRecent(s.Storage.Root)
    }

    public async SaveAs(location: string): Promise<void> {
        const s = this.ActiveSolution; if (s === undefined) return
        const target = this.seams.storageForFolder(location)
        const manifest = new SolutionManifest(s.Name, [...s.Members].map((m) => m.Ref), s.CollectSettings())
        await target.WriteText('solution.json', manifest.stringify())
        const reopened = new SolutionSession(s.Name, target)
        for (const m of s.Members) reopened.AddMember(m.Ref.path, m.Ref.type)
        reopened.IsDirty = false
        this.setActive(reopened)
        this.pushRecent(location)
    }

    public async CloseSolution(): Promise<void> {
        if (!(await this.canReplace())) return
        this.setActive(undefined)
    }

    public OnActivated(): void { /* content host wiring in Task 15/16 */ }

    private async canReplace(): Promise<boolean> {
        const s = this.ActiveSolution
        if (s === undefined || !s.IsDirty) return true
        return this.seams.confirmDiscard()
    }

    private pushRecent(location: string): void {
        const recent = this.RecentSolutions
        // move-to-front, dedupe
        const existing = [...recent].indexOf(location)
        if (existing >= 0) recent.RemoveAt(existing)
        recent.Insert(0, location)
    }

    private resolveMemberFolder(solutionFolder: string, rel: string): string {
        // POSIX join of solutionFolder + rel, collapsing ./ and ../ — a static helper on SolutionPath in Task 8 may host this.
        return SolutionManagerService.joinPosix(solutionFolder, rel)
    }

    private static joinPosix(base: string, rel: string): string {
        const parts = base.split(/[\\/]+/).filter((s) => s.length > 0)
        for (const seg of rel.split(/[\\/]+/)) {
            if (seg === '' || seg === '.') continue
            if (seg === '..') parts.pop()
            else parts.push(seg)
        }
        return (base.startsWith('/') ? '/' : '') + parts.join('/')
    }

    private static throwingSeams(): SolutionSeams {
        return {
            storageForFolder: () => { throw new Error('SolutionManagerService not configured') },
            factoryFor: () => undefined,
            confirmDiscard: async () => true,
        }
    }
}
```

  Add the small methods this references to `SolutionSession` (Task 9/13): `LoadSettings(values)`, `CollectSettings(): Record<string, Record<string, string|number|boolean>>`, and `RemoveAt`/`Insert` are `ObservableCollection` methods — verify their exact names in Step 2 and adjust. If `RecentSolutions` persistence via `ApplicationSettings` is wanted now, defer it: keep the in-memory MRU here; wire `ApplicationSettings` persistence in Task 16 (host) — the spec allows the MRU to persist through the app's settings seam.

- [ ] **Step 5: Run tests + typecheck.** Expected: PASS/clean. (If `LoadSettings`/`CollectSettings` don't exist yet, add minimal versions: `LoadSettings` stores the raw record on the session; `CollectSettings` returns it. Task 13 makes them bag-aware.)

- [ ] **Step 6: Commit.**

```bash
git -C TODL add -A
git -C TODL commit -m "feat(solution): SolutionManagerService one-active lifecycle (New/Open/Save/SaveAs/Close)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 12: `SettingBagDefinition` + `SolutionSettingsRegistry`

**Files:**
- Create: `TODL/src/solution/setting-bag-definition.ts`
- Create: `TODL/src/solution/solution-settings-registry.ts`
- Test: `TODL/src/solution/tests/solution-settings-registry.test.ts`

**Interfaces:**
- Consumes: `SettingDefinition` (`@pragmatic-tech-ai/mural/framework`), `ServiceBase`/`ServiceKey`/`ObservableCollection`.
- Produces:
  - `class SettingBagDefinition { constructor(id: string, title: string, fields: SettingDefinition[]); readonly Id; readonly Title; readonly Fields }`.
  - `class SolutionSettingsRegistry extends ServiceBase { static Key; Contribute(bag: SettingBagDefinition): void /* idempotent by Id */; readonly Definitions: ObservableCollection<SettingBagDefinition>; GetById(id): SettingBagDefinition | undefined }`.

- [ ] **Step 1: Write failing tests.**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SettingDefinition, SettingKind } from '@pragmatic-tech-ai/mural/framework'
import { SettingBagDefinition } from '../setting-bag-definition.js'
import { SolutionSettingsRegistry } from '../solution-settings-registry.js'

function field(key: string, kind = SettingKind.String, def: unknown = ''): SettingDefinition {
    const d = new SettingDefinition(); d.Key = key; d.Kind = kind; d.Default = def; d.Label = key; return d
}

test('Contribute is idempotent by Id', () => {
    const reg = SolutionSettingsRegistry.createForTest()
    const bag = new SettingBagDefinition('npm-registry', 'NPM Registry', [field('registry')])
    reg.Contribute(bag); reg.Contribute(bag)
    assert.equal([...reg.Definitions].length, 1)
    assert.equal(reg.GetById('npm-registry')!.Title, 'NPM Registry')
})
```

- [ ] **Step 2: Confirm `SettingDefinition` construction + `SolutionSettingsRegistry` base pattern.** Re-read `Mural/src/framework/shell/settings/setting-definition.ts` (Task already surfaced it: `Key`/`Label`/`Kind`/`Default`/`Category`/`Choices`/`Min`/`Max` setters). Mirror `ProjectFactoryRegistry` for the `createForTest` shortcut (a registry that doesn't need modules for a unit test — provide a static that constructs with a stub provider, like Task 11).

- [ ] **Step 3: Run to verify failure.** Expected: FAIL.

- [ ] **Step 4: Implement both files.**

```ts
// setting-bag-definition.ts
import type { SettingDefinition } from '@pragmatic-tech-ai/mural/framework'
export class SettingBagDefinition {
    constructor(
        public readonly Id: string,
        public readonly Title: string,
        public readonly Fields: readonly SettingDefinition[],
    ) {}
}
```

```ts
// solution-settings-registry.ts
import { ServiceBase, ServiceKey, MuralBase, MetaData, ObservableCollection, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { SettingBagDefinition } from './setting-bag-definition.js'

export class SolutionSettingsRegistry extends ServiceBase {
    public static readonly Key = new ServiceKey<SolutionSettingsRegistry>('SolutionSettingsRegistry')
    public static readonly DefinitionsKey = MuralBase.RegisterProperty<ObservableCollection<SettingBagDefinition>>(
        SolutionSettingsRegistry, 'Definitions', undefined as unknown as ObservableCollection<SettingBagDefinition>, MetaData.None)
    private readonly byId = new Map<string, SettingBagDefinition>()

    constructor(provider: IServiceProvider) {
        super(provider)
        this.set_property_value(SolutionSettingsRegistry.DefinitionsKey, new ObservableCollection<SettingBagDefinition>())
    }
    public static createForTest(): SolutionSettingsRegistry {
        return new SolutionSettingsRegistry({ get: () => undefined, getRequired: () => { throw new Error('no container') } } as unknown as IServiceProvider)
    }
    public get Definitions(): ObservableCollection<SettingBagDefinition> { return this.get_property_value(SolutionSettingsRegistry.DefinitionsKey) }
    public Contribute(bag: SettingBagDefinition): void {
        if (this.byId.has(bag.Id)) return
        this.byId.set(bag.Id, bag)
        this.Definitions.Add(bag)
    }
    public GetById(id: string): SettingBagDefinition | undefined { return this.byId.get(id) }
}
```

- [ ] **Step 5: Run tests + typecheck.** Expected: PASS/clean.

- [ ] **Step 6: Commit.**

```bash
git -C TODL add -A
git -C TODL commit -m "feat(solution): SettingBagDefinition + SolutionSettingsRegistry (imperative contribute)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 13: `SolutionSettingBag` (live values) + session settings persistence

**Files:**
- Create/replace: `TODL/src/solution/solution-setting-bag.ts` (replace the Task-9 stub)
- Modify: `TODL/src/solution/solution-session.ts` (`LoadSettings`, `CollectSettings`, `SetSettingValue`, populate `SettingBags`)
- Test: `TODL/src/solution/tests/solution-settings-values.test.ts`

**Interfaces:**
- Produces:
  - `class SolutionSettingBag extends Observable { readonly Definition: SettingBagDefinition; readonly Values: Map<string, string|number|boolean>; Get(key): string|number|boolean|undefined; Set(key, value): void }` (Set raises change + notifies the session to mark dirty via a callback).
  - `SolutionSession.BindBags(defs: Iterable<SettingBagDefinition>): void` — builds `SolutionSettingBag`s from definitions, overlaying loaded values; `SolutionSession.CollectSettings()` returns only *touched* bags' value records; `LoadSettings(values)` stashes raw values applied when bags are bound.

- [ ] **Step 1: Write failing tests.**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SettingKind, SettingDefinition } from '@pragmatic-tech-ai/mural/framework'
import { SettingBagDefinition } from '../setting-bag-definition.js'
import { SolutionSession } from '../solution-session.js'

function field(key: string, def: unknown): SettingDefinition { const d = new SettingDefinition(); d.Key = key; d.Kind = SettingKind.String; d.Default = def; return d }

test('untouched bag falls back to defaults and is omitted from CollectSettings', () => {
    const s = new SolutionSession('S', new FakeStorage())
    const bag = new SettingBagDefinition('npm-registry', 'NPM', [field('registry', 'https://default')])
    s.BindBags([bag])
    const live = [...s.SettingBags][0]
    assert.equal(live.Get('registry'), 'https://default')
    assert.deepEqual(s.CollectSettings(), {})   // untouched ⇒ absent
})

test('setting a value marks dirty and is collected', () => {
    const s = new SolutionSession('S', new FakeStorage())
    const bag = new SettingBagDefinition('npm-registry', 'NPM', [field('registry', 'https://default')])
    s.BindBags([bag]); s.IsDirty = false
    const live = [...s.SettingBags][0]
    live.Set('registry', 'https://custom')
    assert.equal(s.IsDirty, true)
    assert.deepEqual(s.CollectSettings(), { 'npm-registry': { registry: 'https://custom' } })
})

test('LoadSettings overlays persisted values when bags bind', () => {
    const s = new SolutionSession('S', new FakeStorage())
    s.LoadSettings({ 'npm-registry': { registry: 'https://saved' } })
    s.BindBags([new SettingBagDefinition('npm-registry', 'NPM', [field('registry', 'https://default')])])
    assert.equal([...s.SettingBags][0].Get('registry'), 'https://saved')
})
```

- [ ] **Step 2: Run to verify failure.** Expected: FAIL.

- [ ] **Step 3: Implement `solution-setting-bag.ts`.**

```ts
import { Observable } from '@pragmatic-tech-ai/todl-runtime'
import type { SettingBagDefinition } from './setting-bag-definition.js'

type Primitive = string | number | boolean

export class SolutionSettingBag extends Observable {
    public readonly Definition: SettingBagDefinition
    public readonly Values = new Map<string, Primitive>()
    private touched = false
    private readonly onChange: () => void

    constructor(definition: SettingBagDefinition, overlay: Record<string, Primitive> | undefined, onChange: () => void) {
        super()
        this.Definition = definition
        this.onChange = onChange
        for (const f of definition.Fields) this.Values.set(f.Key, (f.Default as Primitive))
        if (overlay) { for (const [k, v] of Object.entries(overlay)) { this.Values.set(k, v); this.touched = true } }
    }

    public get IsTouched(): boolean { return this.touched }
    public Get(key: string): Primitive | undefined { return this.Values.get(key) }
    public Set(key: string, value: Primitive): void {
        this.Values.set(key, value); this.touched = true
        this.RaisePropertyChanged(key, undefined, value)
        this.onChange()
    }
    public ToRecord(): Record<string, Primitive> { return Object.fromEntries(this.Values) }
}
```

- [ ] **Step 4: Extend `solution-session.ts`.** Add:

```ts
import { SolutionSettingBag } from './solution-setting-bag.js'
import type { SettingBagDefinition } from './setting-bag-definition.js'
// fields:
private loadedSettings: Record<string, Record<string, string|number|boolean>> = {}
// methods:
public LoadSettings(values: Record<string, Record<string, string|number|boolean>>): void { this.loadedSettings = values ?? {} }
public BindBags(defs: Iterable<SettingBagDefinition>): void {
    for (const def of defs) {
        const bag = new SolutionSettingBag(def, this.loadedSettings[def.Id], () => this.markDirty())
        this.SettingBags.Add(bag)
    }
}
public CollectSettings(): Record<string, Record<string, string|number|boolean>> {
    const out: Record<string, Record<string, string|number|boolean>> = {}
    for (const bag of this.SettingBags) if (bag.IsTouched) out[bag.Definition.Id] = bag.ToRecord()
    // preserve unknown/unbound persisted bags (round-trip safety)
    for (const [id, vals] of Object.entries(this.loadedSettings)) if (!(id in out) && ![...this.SettingBags].some((b) => b.Definition.Id === id)) out[id] = vals
    return out
}
```

  (`markDirty` is the private from Task 9; make it callable here. Confirm `ObservableCollection` iteration per Task 10 Step 2.)

- [ ] **Step 5: Run tests + typecheck.** Expected: PASS/clean. Re-run the Task-11 service tests to confirm no regression.

- [ ] **Step 6: Commit.**

```bash
git -C TODL add -A
git -C TODL commit -m "feat(solution): live setting bags + manifest value persistence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 14: `SettingBagGrid` adapter (bag → PropertyGrid)

**Files:**
- Create: `TODL/src/solution/setting-bag-grid.ts`
- Test: `TODL/src/solution/tests/setting-bag-grid.test.ts`

**Interfaces:**
- Consumes: `GridProperty`, `PropertyKind`, `MapPropertyBag`, `type IPropertyBag` (`@pragmatic-tech-ai/mural/framework`); `SettingKind` (`@pragmatic-tech-ai/mural/framework`); `SolutionSettingBag`.
- Produces: `class SettingBagGrid { static kindOf(k: SettingKind): PropertyKind; static describe(bag: SolutionSettingBag): GridProperty[]; static bagOf(bag: SolutionSettingBag): IPropertyBag }`. The `IPropertyBag` writes back into the `SolutionSettingBag` (so edits flip session dirty).

- [ ] **Step 1: Write failing tests.**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SettingKind, SettingDefinition, PropertyKind } from '@pragmatic-tech-ai/mural/framework'
import { SettingBagDefinition } from '../setting-bag-definition.js'
import { SolutionSettingBag } from '../solution-setting-bag.js'
import { SettingBagGrid } from '../setting-bag-grid.js'

function field(key: string, kind: SettingKind, def: unknown): SettingDefinition { const d = new SettingDefinition(); d.Key = key; d.Kind = kind; d.Default = def; d.Label = key; return d }

test('kindOf maps SettingKind → PropertyKind', () => {
    assert.equal(SettingBagGrid.kindOf(SettingKind.Boolean), PropertyKind.Boolean)
    assert.equal(SettingBagGrid.kindOf(SettingKind.Number), PropertyKind.Number)
    assert.equal(SettingBagGrid.kindOf(SettingKind.Choice), PropertyKind.Enum)
    assert.equal(SettingBagGrid.kindOf(SettingKind.String), PropertyKind.Text)
    assert.equal(SettingBagGrid.kindOf(SettingKind.FilePath), PropertyKind.Text)
    assert.equal(SettingBagGrid.kindOf(SettingKind.Color), PropertyKind.Color)
})

test('describe yields one GridProperty per field with the mapped kind', () => {
    const def = new SettingBagDefinition('npm', 'NPM', [field('registry', SettingKind.String, ''), field('secure', SettingKind.Boolean, true)])
    const bag = new SolutionSettingBag(def, undefined, () => {})
    const props = SettingBagGrid.describe(bag)
    assert.equal(props.length, 2)
    assert.equal(props[0].Kind, PropertyKind.Text)
    assert.equal(props[1].Kind, PropertyKind.Boolean)
})

test('bagOf writes back into the SolutionSettingBag', () => {
    const def = new SettingBagDefinition('npm', 'NPM', [field('registry', SettingKind.String, 'd')])
    let changed = false
    const bag = new SolutionSettingBag(def, undefined, () => { changed = true })
    const pbag = SettingBagGrid.bagOf(bag)
    pbag.SetValue('registry', 'https://custom')
    assert.equal(bag.Get('registry'), 'https://custom')
    assert.equal(changed, true)
})
```

- [ ] **Step 2: Confirm `MapPropertyBag`/`IPropertyBag` surface.** Re-read `Mural/src/framework/property-grid/property-bag.ts` for the `IPropertyBag` methods (`GetValue`/`SetValue`/`IsReadOnly`/`Observe` per the spec) and `MapPropertyBag`'s constructor (accessor map). Match exact names in the implementation.

- [ ] **Step 3: Run to verify failure.** Expected: FAIL.

- [ ] **Step 4: Implement `setting-bag-grid.ts`.**

```ts
import { GridProperty, PropertyKind, MapPropertyBag, type IPropertyBag } from '@pragmatic-tech-ai/mural/framework'
import { SettingKind } from '@pragmatic-tech-ai/mural/framework'
import type { SolutionSettingBag } from './solution-setting-bag.js'

export class SettingBagGrid {
    static kindOf(kind: SettingKind): PropertyKind {
        switch (kind) {
            case SettingKind.Boolean:  return PropertyKind.Boolean
            case SettingKind.Number:   return PropertyKind.Number
            case SettingKind.Choice:   return PropertyKind.Enum
            case SettingKind.Color:    return PropertyKind.Color
            case SettingKind.String:
            case SettingKind.FilePath:
            default:                   return PropertyKind.Text
        }
    }
    static describe(bag: SolutionSettingBag): GridProperty[] {
        return bag.Definition.Fields.map((f) => {
            const opts = { displayName: f.Label, category: bag.Definition.Title, description: f.Description }
            const kind = SettingBagGrid.kindOf(f.Kind)
            if (kind === PropertyKind.Enum) return GridProperty.enumOf(f.Key, [...(f.Choices ?? [])], opts)
            if (kind === PropertyKind.Boolean) return GridProperty.bool(f.Key, opts)
            if (kind === PropertyKind.Number) return GridProperty.number(f.Key, opts)
            if (kind === PropertyKind.Color) return GridProperty.color(f.Key, opts)
            return GridProperty.text(f.Key, opts)
        })
    }
    static bagOf(bag: SolutionSettingBag): IPropertyBag {
        // Map each field key to a get/set accessor over the SolutionSettingBag.
        const accessors = new Map<string, { get: () => unknown; set: (v: unknown) => void }>()
        for (const f of bag.Definition.Fields) {
            accessors.set(f.Key, { get: () => bag.Get(f.Key), set: (v) => bag.Set(f.Key, v as string | number | boolean) })
        }
        return new MapPropertyBag(accessors)   // adjust to MapPropertyBag's real accessor shape (Step 2)
    }
}
```

- [ ] **Step 5: Run tests + typecheck.** Expected: PASS/clean.

- [ ] **Step 6: Commit.**

```bash
git -C TODL add -A
git -C TODL commit -m "feat(solution): PropertyGrid adapter for setting bags

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 15: `SolutionTreeVM` (explorer view-model)

**Files:**
- Create: `TODL/src/solution/solution-tree-vm.ts`
- Test: `TODL/src/solution/tests/solution-tree-vm.test.ts`

**Interfaces:**
- Consumes: `Observable`, `ObservableCollection`, `IStorage`, `SolutionSession`, `SolutionMember`, `compareStorageEntries`.
- Produces:
  - `class SolutionNodeVM extends Observable { Title: string; readonly IsDirectory: boolean; readonly Children: ObservableCollection<SolutionNodeVM> | undefined; OnExpand(): Promise<void> }` (lazy folder loader mirroring the app's `FolderNodeVM`).
  - `class SolutionTreeVM extends Observable { constructor(session: SolutionSession); readonly Roots: ObservableCollection<SolutionMemberNodeVM> }` where a member node exposes `Title`, `IsResolved`, and (if resolved) a folder subtree from the member's `IStorage.List`.

- [ ] **Step 1: Write failing tests** (logic only — no rendering):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionSession } from '../solution-session.js'
import { SolutionTreeVM } from '../solution-tree-vm.js'

test('tree has one root per member; unresolved flagged', async () => {
    const s = new SolutionSession('S', new FakeStorage())
    const a = s.AddMember('./api', 'architecture')
    const storage = new FakeStorage(); await storage.WriteText('src/main.todl', 'x')
    a.Project = { kind: 'fake' }        // resolved
    s.AddMember('./x', 'missing')       // unresolved
    const tree = new SolutionTreeVM(s, () => storage)
    const roots = [...tree.Roots]
    assert.equal(roots.length, 2)
    assert.equal(roots[0].IsResolved, true)
    assert.equal(roots[1].IsResolved, false)
})

test('expanding a resolved member lists its folder structure', async () => {
    const s = new SolutionSession('S', new FakeStorage())
    const a = s.AddMember('./api', 'architecture'); a.Project = {}
    const storage = new FakeStorage()
    await storage.WriteText('src/main.todl', 'x'); await storage.WriteText('project.plexus', '{}')
    const tree = new SolutionTreeVM(s, () => storage)
    const root = [...tree.Roots][0]
    await root.OnExpand()
    const names = [...root.Children!].map((c) => c.Title)
    assert.ok(names.includes('src'))
    assert.ok(names.includes('project.plexus'))
})
```

- [ ] **Step 2: Read the existing `FolderNodeVM` for the pattern.** `TODL/app/src/renderer/modules/package-compiler/folder-node-vm.ts` (referenced in memory). Mirror its lazy `OnExpand` one-shot loader and `file`/`dir` factory shape, but source entries from `IStorage.List` + `compareStorageEntries` (not the app's `readDir`).

- [ ] **Step 3: Run to verify failure.** Expected: FAIL.

- [ ] **Step 4: Implement `solution-tree-vm.ts`** (member roots + lazy folder nodes; `constructor(session, storageForMember: (m) => IStorage)` so it's testable). Use `compareStorageEntries` to order `List` output. Keep everything as class methods.

- [ ] **Step 5: Run tests + typecheck.** Expected: PASS/clean.

- [ ] **Step 6: Commit.**

```bash
git -C TODL add -A
git -C TODL commit -m "feat(solution): SolutionTreeVM explorer view-model

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 16: `SolutionModule` declaration + views + package exports

**Files:**
- Create: `TODL/src/solution/solution.module.mu`
- Create: `TODL/src/solution/solution.resources.mu`
- Modify: `TODL/src/index.ts` (public exports)
- Modify/confirm: markup registration (symbol-table) — see Step 2.

**Interfaces:**
- Produces: `SolutionModule` (a Mural module referencing `SolutionManagerService` + `SolutionSettingsRegistry` as services and a `Solutions` `Capability`), the view templates, and the barrel exports of the solution public surface.

- [ ] **Step 1: Author the module.** `solution.module.mu` (mirror `package-manager.module.mu`):

```
import SolutionManagerService from "./solution-manager-service.ts"
import SolutionSettingsRegistry from "./solution-settings-registry.ts"

module SolutionModule [ Name = "Solutions" ] {
    .services: { SolutionManagerService, SolutionSettingsRegistry }

    Capability [
        Name       = "Solutions",
        Icon       = @Solutions,
        ServiceKey = SolutionManagerService
    ]
}
```

- [ ] **Step 2: Decide where `.mu` compiles + register markup symbols.** The `todl` package is TS-only today; `.mu` is compiled by the CONSUMER's `vitePluginMural` (the app). So the `todl` package SHIPS `.mu` as source. Two sub-decisions to VERIFY, in order:
  - **(2a)** Confirm `vitePluginMural` in the app transforms `.mu` imported from a dependency package (not only from the app's own `src`). Check `TODL/app/electron.vite.config.ts` + the plugin's include filter (`grep -rn "\\.mu" Mural/src/tooling`). If it does, `solution.module.mu` can be imported by `app.mu` via `import SolutionModule from "@pragmatic-tech-ai/todl/solution/solution.module.mu"` — add a `./solution/*` subpath to `TODL/package.json` `exports` and include `.mu` files in the package `files`. Register markup names (`SolutionManagerService`, `SolutionSettingsRegistry`, `SolutionTreeVM`, `SolutionMemberNodeVM`, `SolutionSettingBag`, and the `Solutions` icon) in the compiler symbol-table the app uses (the app-side registration, since the app runs the compiler).
  - **(2b) Fallback** if the plugin does NOT process dependency `.mu`: author `SolutionModule` **imperatively in TS** in the `todl` package (`solution-module.ts` constructing a `ShellModule` with the services + capability — read `Mural/src/framework/shell/module.ts` for the `ShellModule` API), export it, and let `app.mu` do `import SolutionModule from "@pragmatic-tech-ai/todl"`. The `.resources.mu` view templates then live in the APP (`TODL/app/src/renderer/modules/solution/`), authored there where the plugin runs. Pick whichever the verification supports; record the choice in the commit body.

- [ ] **Step 3: Author view templates.** `solution.resources.mu` (or the app-side equivalent per 2b): a `DataTemplate[SolutionManagerService]` rendering the side pane (New/Open/Save toolbar bound to header commands + the `SolutionTreeVM` in a `TreeView` + a settings `PropertyGrid` region), and `HierarchicalDataTemplate` for the tree nodes (mirror the compiler page's tree templates). Bind the settings pane to `PropertyGrid [ Descriptors = <bag grid>, Target = <bag-of> ]` using the Task-14 adapter.

- [ ] **Step 4: Export the public surface.** In `TODL/src/index.ts` add:

```ts
export { SolutionManagerService } from './solution/solution-manager-service.js'
export { SolutionSettingsRegistry } from './solution/solution-settings-registry.js'
export { SettingBagDefinition } from './solution/setting-bag-definition.js'
export { SolutionSession } from './solution/solution-session.js'
export { SolutionManifest } from './solution/solution-manifest.js'
export { SolutionTreeVM } from './solution/solution-tree-vm.js'
export { SettingBagGrid } from './solution/setting-bag-grid.js'
export type { IProjectFactory } from './solution/project-factory.js'
// If 2b (TS module): export { SolutionModule } from './solution/solution-module.js'
```

- [ ] **Step 5: Build + full package test.** Run: `cd TODL && npx tsc --noEmit && npx tsx --conditions=development --test --test-force-exit "src/solution/tests/*.test.ts"` and the package build (`npm run build` if it exists — `grep '"build"' TODL/package.json`). Expected: clean; all solution unit tests green.

- [ ] **Step 6: Commit.**

```bash
git -C TODL add -A
git -C TODL commit -m "feat(solution): SolutionModule + views + package exports

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# PHASE 5 — Wire into the TODL host app

> Working directory: `TODL/app/`. Test: `npm test`. e2e: `npm run test:e2e`. Build: `npm run build`.

### Task 17: Real `todl-package` project factory

**Files:**
- Create: `TODL/app/src/renderer/modules/solution/todl-package-project-factory.ts`
- Test: `TODL/app/src/renderer/modules/solution/tests/todl-package-project-factory.test.ts`

**Interfaces:**
- Consumes: `IProjectFactory`, `IStorage` (`@pragmatic-tech-ai/todl` / `@pragmatic-tech-ai/todl-runtime`); the app's existing compile/manifest reading (`readProject`/`parseManifest` from `@pragmatic-tech-ai/todl`).
- Produces: `class TodlPackageProjectFactory implements IProjectFactory` registered under type id `'todl-package'` via `ProjectFactoryRegistry` (`ProjectFactoryDefinition [ Type="todl-package", Factory=... ]`).

- [ ] **Step 1: Write failing tests** with `FakeStorage`: `createProject` writes a `project.plexus`-style manifest into the storage; `openProject` reads it back into a project object; `saveProject` round-trips. Assert on `FakeStorage` contents.

- [ ] **Step 2: Read the existing folder→compile flow.** `TODL/src/package-manager/project.ts` (`readProject`, `readProjectFiles`, `SKIP_DIRS`) and `manifest.ts` (`ProjectManifest`, `parseManifest`). The factory adapts these to `IStorage` (read/write through the storage, not `node:fs`).

- [ ] **Step 3: Run to verify failure → implement → run to pass.** Standard TDD cycle.

- [ ] **Step 4: Commit.**

```bash
git -C TODL/app add -A
git -C TODL/app commit -m "feat(solution): todl-package project factory (app)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 18: App `IStorage` backend (`local`)

**Files:**
- Create: `TODL/app/src/renderer/services/storage/app-local-storage.ts`
- Create: `TODL/app/src/renderer/services/storage/storage-provider-registry.ts` (or reuse Plexus's pattern)
- Test: `TODL/app/src/renderer/services/storage/tests/app-local-storage.test.ts`

**Interfaces:**
- Consumes: `IStorage`, `ILocalFileAccess` (`@pragmatic-tech-ai/todl-runtime`); the app's fs IPC bridge (the same bridge behind `RegistryClient.readDir`/`pickDirectory` — extend it with read/write/list/mkdir/rename if missing).
- Produces: `class AppLocalStorage implements IStorage, ILocalFileAccess` rooted at an absolute folder; `class AppStorageProviderRegistry extends ServiceBase` registering the `'local'` factory (mirror `Plexus/.../storage-provider-registry.ts`). The `SolutionManagerService.Configure` seam's `storageForFolder` calls `registry.Create('local', folder)`.

- [ ] **Step 1: Inventory the app's fs bridge.** `grep -rn "readDir\|ReadText\|WriteText\|fs:" TODL/app/src/main TODL/app/src/preload TODL/app/src/renderer/env.d.ts`. The compiler-page work added `fs:readDir` + `dialog:pickDirectory`; add `fs:readText/writeText/exists/mkdir/rename/list` IPC channels to match `IStorage` (main handler + preload + `env.d.ts` type + a renderer client), following the exact pattern that `register-ipc.ts`/`registry-client.ts` already use.

- [ ] **Step 2: TDD `AppLocalStorage`.** Because it needs the bridge, test it against a small in-memory fake of the bridge (inject the bridge object), asserting path joining + delegation — mirror how `LocalFileStorage` delegates to `FileSystemService` (`Plexus/.../local-file-storage.ts`, already surfaced), reusing its `abs()`/`ensureParent()` logic verbatim (adapted to the app bridge method names).

- [ ] **Step 3: Implement → pass → commit.**

```bash
git -C TODL/app add -A
git -C TODL/app commit -m "feat(solution): local IStorage backend + provider registry (app)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 19: Contribute the `npm-registry` setting bag

**Files:**
- Create: `TODL/app/src/renderer/modules/solution/npm-registry-bag.ts`
- Test: `TODL/app/src/renderer/modules/solution/tests/npm-registry-bag.test.ts`

**Interfaces:**
- Consumes: `SettingBagDefinition`, `SolutionSettingsRegistry` (`@pragmatic-tech-ai/todl`); `SettingDefinition`, `SettingKind` (`@pragmatic-tech-ai/mural/framework`).
- Produces: `class NpmRegistryBag { static definition(): SettingBagDefinition; static contribute(registry: SolutionSettingsRegistry): void }` with fields `registry` (String), `scope` (String), `org` (String), `tokenSource` (Choice: `stored`|`env`), `tokenEnvVar` (String) — **no token-literal field** (security constraint).

- [ ] **Step 1: Write failing test.** Assert `definition()` has exactly those 5 field keys, `tokenSource` is `SettingKind.Choice` with choices `['stored','env']`, and there is NO field whose key contains `token` other than `tokenSource`/`tokenEnvVar` (guards the security constraint):

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NpmRegistryBag } from '../npm-registry-bag.js'

test('npm-registry bag has the 5 expected fields and no token-literal', () => {
    const def = NpmRegistryBag.definition()
    const keys = def.Fields.map((f) => f.Key)
    assert.deepEqual(keys.sort(), ['org', 'registry', 'scope', 'tokenEnvVar', 'tokenSource'])
    assert.ok(!keys.some((k) => /^token$|secret|password/i.test(k)))
})
```

- [ ] **Step 2: Run → implement → pass.** Implement `definition()` building the `SettingDefinition`s; `contribute()` calls `registry.Contribute(this.definition())`.

- [ ] **Step 3: Commit.**

```bash
git -C TODL/app add -A
git -C TODL/app commit -m "feat(solution): contribute npm-registry setting bag (no token literal)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 20: Reference `SolutionModule` from `app.mu` + configure seams + e2e

**Files:**
- Modify: `TODL/app/src/renderer/app.mu`
- Modify: the app bootstrap (where services are configured) — call `SolutionManagerService.Configure({...})` with the real `storageForFolder` (via `AppStorageProviderRegistry`), `factoryFor` (via `ProjectFactoryRegistry`), and `confirmDiscard` (via the Mural `DialogService`/`ConfirmDialog`), and call `NpmRegistryBag.contribute(registry)` + `session.BindBags(registry.Definitions)` on solution load.
- Modify: `TODL/app/src/renderer/app-icons.mu` — add the `@Solutions` icon.
- Create: `TODL/app/tests/e2e/solution.spec.ts` (Playwright).

**Interfaces:**
- Consumes: `SolutionModule` (per Task 16's 2a/2b decision), all app-side services.

- [ ] **Step 1: Verify the module import path works.** Per Task 16 Step 2, either import the `.mu` module from the dependency (2a) or the TS `SolutionModule` (2b). Add the chosen import to `app.mu` and register `SolutionModule` in the `.modules:` block (mirror how `PackageManagerModule` is added — `grep -n "modules\|Module" TODL/app/src/renderer/app.mu`).

- [ ] **Step 2: Wire the seams + bag binding at bootstrap.** Where the app constructs/roots services (the file that today registers `RegistryClient`, `DialogService`, `ContentHostService`, `NavigationService` — `TODL/app/src/renderer/main.ts` per memory), resolve `SolutionManagerService` after the shell is up and call `Configure({ storageForFolder: (f) => providerRegistry.Create('local', f), factoryFor: (t) => resolveFactory(projectFactoryRegistry, provider, t), confirmDiscard: () => ConfirmDialog.show(dialogs, {...}) })`; contribute the npm bag; on `OpenSolution`/`NewSolution` completion, call `session.BindBags(solutionSettingsRegistry.Definitions)`. Add `resolveFactory` as a small class/static that does `ProjectFactoryRegistry.GetByType(type)?.Factory` → `provider.getRequired(token)`.

- [ ] **Step 3: Build the app.** Run: `cd TODL/app && npm run build` — Expected: clean; the `.mu` compiles (this is where a 2a/2b mistake surfaces). If `.mu` from the dependency fails to compile, switch to 2b.

- [ ] **Step 4: Write a Playwright e2e** (`solution.spec.ts`): launch via `_electron`, invoke New Solution (pick a temp dir through the bridge fake or a real temp dir), add a member folder that has a `todl-package` manifest, Save, confirm `solution.json` exists, Close, Open the same folder, assert the member row appears in the Solution Explorer. Follow the existing `package-compiler.spec.ts` harness (coordinate clicks, `Symbol.for('mural:visual-backref')`, in-app dialog targeting).

- [ ] **Step 5: Run tests + e2e.** Run: `cd TODL/app && npm test && npm run test:e2e` — Expected: green.

- [ ] **Step 6: Commit.**

```bash
git -C TODL/app add -A
git -C TODL/app commit -m "feat(solution): reference SolutionModule in app.mu + wire seams + e2e

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- Storage relocation (spec §1) → Tasks 1–7. ✓
- SolutionManagerService + SolutionSession one-active lifecycle (spec §2) → Tasks 9, 11. ✓
- Manifest schema + serialization, unknown-preservation, version reject, POSIX (spec §3) → Task 8 (+ round-trip preservation in Task 13's `CollectSettings`). ✓
- Multi-project session + Solution Explorer, open-all, unresolved members (spec §4) → Tasks 10, 15. ✓
- Cross-project setting bags, imperative contribute, PropertyGrid editing (spec §5) → Tasks 12, 13, 14. ✓
- The Mural module declared in `todl`, referenced by app.mu (spec §6) → Tasks 16, 20. ✓
- Real `todl-package` factory in the app; `local` backend; npm bag (spec scope decision) → Tasks 17, 18, 19. ✓
- Testing strategy (fakes, no Electron in unit tests) → every Phase-4 task + Task 20 e2e. ✓
- Bottom-up sequencing → Phases 1–5 ordering. ✓
- Non-goals (one active, open-all, no Plexus migration, no remote backend, no token literal) → respected; Task 19 enforces the token-literal constraint; Task 6 leaves Plexus un-migrated. ✓

**Placeholder scan:** No "TBD"/"implement later". The two genuinely open integration points — (a) whether `vitePluginMural` compiles dependency `.mu`, (b) `ObservableCollection`/`Observable`/`MapPropertyBag` exact method names — are handled by **verification steps with concrete commands and concrete fallbacks**, not by hand-waving. That is deliberate: they are facts to confirm in-repo, and both branches are spelled out.

**Type consistency:** `SolutionMemberRef { path, type }` used identically in Tasks 8/9/11/16. `IProjectFactory` (openProject/createProject/saveProject) defined in Task 10, consumed in 11/17. `SolutionSession` methods (`AddMember`, `RemoveMember`, `OpenMembers`, `LoadSettings`, `CollectSettings`, `BindBags`, `IsDirty`) are introduced across Tasks 9/10/13 and consumed consistently in Task 11 — Task 11 notes the minimal stubs to add if run before Task 13. `SettingBagDefinition`/`SolutionSettingsRegistry`/`SolutionSettingBag`/`SettingBagGrid` names match across Tasks 12–14, 16, 19. `SolutionManagerService.Key`/`ActiveSolution`/`RecentSolutions`/`Configure` consistent across Tasks 11, 16, 20.

**Known ordering note for the executor:** Task 9 references `SolutionSettingBag` (Task 13) and Task 11 references `LoadSettings`/`CollectSettings` (Task 13). Land minimal stubs in Task 9/11 (empty `SolutionSettingBag`, pass-through `LoadSettings`/`CollectSettings`) and enrich them in Task 13 — each task stays independently green. This is called out inline in those tasks.
