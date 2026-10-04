# LSP `solution-services/lsp` Module — Wave 1 (todl engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the TODL language service into one solution-scoped `solution-services/lsp` module whose host half owns the single symbol resolver + warm cache and whose worker half is pure OOP analysis, and fix the root-cause defect so unpublished in-solution members contribute their symbols.

**Architecture:** A new `src/solution-services/lsp/` module split by responsibility: a **host half** (`SolutionLanguageService`, the registered service — owns a durable `SolutionSession` that constructs the one `SolutionBaseResolver`, the warm composed `Domain`/snapshot cache, all file I/O, and incremental lifecycle-event cache maintenance) and a **worker half** (the analysis providers, converted from free functions to cohesive OOP classes, driven by an `AnalysisEngine` dispatcher over a typed context protocol). The host calls the engine through an `IAnalysisEngine` seam — in-process in todl/tests, across a real Web Worker in Plexus (Wave 2). The defect fix is a version-free compile path (`0.0.0-local` synthetic identity) used only by the resolver's live-member branch.

**Tech Stack:** TypeScript (ESM, strict: `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), `vscode-languageserver-types@3.17.5`, todl-runtime composition (`Module`/`CompositionRoot`/`ServiceProvider`/`ServiceKey`), mural `.mu` module compiler (`npm run compile:mu`), node test runner via `tsx --conditions=development`.

**Spec:** `TODL/docs/superpowers/specs/2026-10-03-lsp-solution-services-module-design.md` (also registered in GitHub Project "Architecture Agentic Suite" as Kind=Spec, item `PVTI_lADOE0Zc984Biu4ozg-e4ks`). This plan implements **Wave 1 only** (the todl engine). Wave 2 (Plexus adoption) and Wave 3 (cleanup + e2e) are separate plans.

## Global Constraints

- **House style (both repos):** OOP — no module-level free functions or mutable module data; every function is a method (instance or `static`) on the type it belongs to. Allman braces. Real `enum`s over string-literal unions. `IDisposable`/`dispose()` teardown. VMs extend `Observable`. PascalCase for all interfaces and public methods. ESM imports carry `.js` extensions.
- **No inline reused/user-facing string literals** — hoist to `private static readonly` PascalCase constants. `.mu` markup labels are exempt.
- **Publishing keeps a real version.** The version-free compile (`0.0.0-local`) is strictly for in-solution resolution; `publish()`, `PackageCompiler.compile`, and `PublishPackageAction` keep their `toPackageJson`→`packageVersion` path untouched; a missing publishable version is still an error *at publish time*.
- **Minimize I/O / responsiveness is an acceptance criterion:** no per-keystroke file reads; cache updates are incremental (targeted `Invalidate(memberId)` + dependents), never a blind full rebuild on an edit.
- **tsconfig strictness:** guard indexed access; omit optional fields rather than passing `undefined`.
- **Tests live in a `tests/` subfolder** next to the code they exercise. Runner globs `src/**/*.test.ts`.
- **Latest packages, but scope to todl.** Wave 1 publishes a new todl release; it does **not** upgrade Plexus — removing the `./language-service` / `./language-server` exports + `bin` is a breaking change Plexus only absorbs in Wave 2. Do not reinstall Plexus against this release in Wave 1.
- **Work tracking:** specs and plans live in the GitHub Project (Kind=Spec/Plan), not only on disk. Register this plan (Task 16).

## Review Focus

- **Version-mismatch warning on a version-free live member:** a member that is unpublished *and* whose manifest declares a real `packageVersion` differing from a consumer's binding must still emit the `versionMismatch` warning. The warning reads `producer.manifest.packageVersion` (solution-base-resolver.ts:255-257), NOT the synthetic `0.0.0-local` identity — the version-free compile must not change which value the warning reads. Covered by Task 2.
- **Cyclic in-solution references:** member A bases on B and B bases on A. The version-free compile must not infinite-loop; the resolver's `resolving` set + DFS `onPath` cycle guards (solution-base-resolver.ts:48,412,222,276) must still trip and fall through to published/`cyclicProblem`. Covered by Task 2.
- **Stale base-set token:** after a lifecycle event bumps the token, a feature request issued before the worker re-receives bases must use the fresh base-set — the host sends the full base-set whenever the token changed, and the engine never answers from a base-set older than the request's token. Covered by Task 10 and Task 12.
- **Incremental eviction of dependents:** removing/editing a member that others depend on must evict the member *and* its transitive dependents (`withDependents`), so consumers don't keep stale symbols; add must not orphan cache entries. Covered by Task 13.
- **Request for a URI under no project root:** `ProjectRegistry.projectFor` longest-prefix returns `null`; every `ILanguageService` method must return an empty/`null` result gracefully, never throw. Covered by Task 11 and Task 12.

---

### Task 1: Version-free compile path on `ProjectModelProvider`

**Files:**
- Modify: `src/solution-services/project-services/generators/project-model-provider.ts`
- Test: `src/solution-services/project-services/generators/tests/project-model-provider-local.test.ts` (Create)

**Interfaces:**
- Consumes: `compilePackage` (publish.ts:90), `PackageIdentity`, `ProjectModel`, `TodlDocument`, existing `CollectSources()`/`ResolveBases()`/`DependencyRefs()` (project-model-provider.ts:48,78,92).
- Produces: `public async CompileLocalWithBases(bases: readonly TodlDocument[]): Promise<ProjectModel>` and `public async CompileLocal(): Promise<ProjectModel>` — same `ProjectModel` shape as `CompileWithBases`/`Compile`, but never throws on a missing publishable version.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProjectModelProvider } from '../project-model-provider.js'
import { EmptySource } from '... existing test helper or IPackageSource stub ...'
// Build a MetaModel/Library manifest with NO packageVersion and one .todl source in a FakeStorage.

test('CompileLocal produces symbols for a member with no publishable version', async () =>
{
    const provider = new ProjectModelProvider(storageWithOneConceptFile, manifestNoVersion, EmptySource)
    const model = await provider.CompileLocal()
    assert.equal(model.errors.length, 0)
    assert.ok(model.package, 'a package/document is produced')
    assert.ok(model.package.document.ids.includes('my-concept'))
})

test('publish path still throws for the same version-less manifest', () =>
{
    assert.throws(() => toPackageJson(manifestNoVersion), /has no publishable version/)
})

test('synthetic identity does not change symbols vs a versioned compile', async () =>
{
    const local = await new ProjectModelProvider(storage, manifestNoVersion, EmptySource).CompileLocal()
    const versioned = await new ProjectModelProvider(storage, { ...manifestNoVersion, packageVersion: '1.2.3' }, EmptySource).CompileWithBases([])
    assert.deepEqual(local.package?.document.ids, versioned.package?.document.ids)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/solution-services/project-services/generators/tests/project-model-provider-local.test.ts"`
Expected: FAIL — `CompileLocal is not a function`.

- [ ] **Step 3: Implement the version-free compile**

Add the constant and two methods to `ProjectModelProvider`. Mirror `CompileWithBases` (project-model-provider.ts:60-72) exactly, replacing the `toPackageJson` identity (lines 63-64) with a synthetic one; reuse `CollectSources`, `DependencyRefs`, `ResolveBases` unchanged.

```ts
private static readonly LocalVersion = '0.0.0-local'

public async CompileLocal(): Promise<ProjectModel>
{
    const bases = await this.ResolveBases()
    return this.CompileLocalWithBases(bases)
}

public async CompileLocalWithBases(bases: readonly TodlDocument[]): Promise<ProjectModel>
{
    const sources = await this.CollectSources()
    const identity: PackageIdentity =
    {
        id: this.manifest.id ?? this.manifest.name,
        version: ProjectModelProvider.LocalVersion,
        name: this.manifest.name,
    }
    const outcome = compilePackage([...bases], sources, identity, ProjectModelProvider.DependencyRefs(this.manifest))
    if (outcome.package === undefined)
    {
        return { errors: outcome.diagnostics ?? [] /* match CompileWithBases failure shape at :67-70 */ }
    }
    return { package: outcome.package, errors: [] }
}
```

Confirm the `manifest.id` field exists on `ProjectManifest`; if the id field has another name, use `packageId`-style access that does NOT throw (do not call the throwing `packageId` from package-json.ts:47). Match the exact failure-branch shape of `CompileWithBases` (project-model-provider.ts:67-70).

- [ ] **Step 4: Run tests to verify they pass**

Run: the Step 2 command. Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git -C TODL add -A && git -C TODL commit -m "feat(lsp): version-free CompileLocal on ProjectModelProvider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Resolver's live-member branch uses the version-free compile

**Files:**
- Modify: `src/solution-services/solution-manager/engine/solution-base-resolver.ts` (`compileMember` ~:404-425; `resolveOneBase` ~:206-281)
- Test: `src/solution-services/solution-manager/engine/tests/solution-base-resolver-local.test.ts` (Create)

**Interfaces:**
- Consumes: `ProjectModelProvider.CompileLocal` / `CompileLocalWithBases` (Task 1).
- Produces: no new public surface; `TryGet`/`ResolveBasesFor` now resolve unpublished in-solution members.

- [ ] **Step 1: Write the failing test** — reproduce the exact "0 bases" probe.

```ts
test('an unpublished in-solution member contributes its symbols to a consumer', async () =>
{
    // Solution with member "microsoft" (Library, NO packageVersion) exporting concept "tenant",
    // and consumer "landscape" whose manifest.libraries binds "microsoft".
    const resolver = makeResolverOver(solutionWithUnpublishedLibrary)
    const bases = await resolver.ResolveBasesFor(landscapeManifest)
    assert.ok(bases.documents.some(d => d.ids.includes('tenant')), 'microsoft symbols resolved')
    assert.equal(bases.problems.filter(p => /no publishable version|not published/.test(p.message)).length, 0)
})

test('published fallback still works when no live producer exists', async () => { /* ... */ })

test('versionMismatch still warns when the live producer declares a real packageVersion', async () =>
{
    // producer manifest HAS packageVersion '2.0.0'; consumer binds '@1.0.0'
    const bases = await resolver.ResolveBasesFor(consumerBinding_1_0_0)
    assert.ok(bases.problems.some(p => /binding requests @1.0.0, project is @2.0.0/.test(p.message)))
})

test('cyclic in-solution references do not hang and fall through', async () => { /* A<->B, assert returns with a cyclic problem, no timeout */ })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/solution-services/solution-manager/engine/tests/solution-base-resolver-local.test.ts"`
Expected: FAIL — first test shows microsoft symbols absent / "no publishable version" problem present (current behavior).

- [ ] **Step 3: Switch the two live-compile call sites**

- In `compileMember` (solution-base-resolver.ts:415) replace `new ProjectModelProvider(storage, manifest, this).Compile()` with `.CompileLocal()`.
- In `resolveOneBase` (solution-base-resolver.ts:246) replace the `CompileWithBases(...)` call with `CompileLocalWithBases(...)`.
- Leave the `versionMismatch` block (solution-base-resolver.ts:255-257) untouched — it reads `producer.manifest.packageVersion`, which is still the real declared value.
- Leave the `resolving`/`onPath` cycle guards untouched.

- [ ] **Step 4: Run to verify pass**

Run: the Step 2 command, then the resolver's existing suite:
`npx tsx --conditions=development --test --test-force-exit "src/solution-services/solution-manager/engine/tests/solution-base-resolver*.test.ts"`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git -C TODL add -A && git -C TODL commit -m "fix(lsp): resolve unpublished in-solution members via CompileLocal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `SolutionSession` composes through the one resolver

**Files:**
- Modify: `src/solution-services/solution-manager/engine/solution-session.ts` (constructor/`compose` — accept the resolver as its `PackageSource`)
- Modify: `src/solution-services/solution-manager/engine/solution-manager-service.ts` (`Compose` ~:163-168 — construct the session over the resolver, not `this.packages`)
- Test: `src/solution-services/solution-manager/engine/tests/solution-session-unified.test.ts` (Create)

**Interfaces:**
- Consumes: `SolutionBaseResolver` (implements `IPackageSource`), `SolutionBaseResolver.Key`, existing `SolutionSession(source)` ctor, `Domain(source)`.
- Produces: `SolutionManagerService.Compose` diagnostics now reflect the live-first symbol universe (same as the LSP).

- [ ] **Step 1: Confirm the type seam** — verify `SolutionBaseResolver` (an `IPackageSource`) satisfies the `PackageSource` parameter of `Domain`/`SolutionSession`. If `PackageSource` and `IPackageSource` differ, add a thin adapter method rather than widening types. Record the finding inline in the commit body.

- [ ] **Step 2: Write the failing test**

```ts
test('Compose resolves an unpublished member\'s concepts (no PackageUnresolved for in-solution symbols)', async () =>
{
    const mgr = makeManagerWith(solutionWithUnpublishedLibraryAndConsumer)
    const diags = await mgr.Compose(membersOf(solution))
    assert.equal(diags.filter(d => d.code === DiagnosticCode.PackageUnresolved && d.message.includes('microsoft')).length, 0)
})

test('published-only composition still works', async () => { /* existing behavior preserved */ })
```

- [ ] **Step 3: Run to verify fail** — Expected: FAIL (today `Compose` uses `this.packages`, published-only, so the unpublished member is unresolved).

- [ ] **Step 4: Wire the session to the resolver**

In `SolutionManagerService.Compose` (solution-manager-service.ts:163-168), resolve/construct the `SolutionBaseResolver` (via `this.Provider.get(SolutionBaseResolver.Key)` or the host-owned instance) and pass it as the session's source: `const session = new SolutionSession(resolver)`. The resolver's `inner()` already supplies the published store as fallback. Keep `compose`'s deps-first load + per-member catch (solution-session.ts:31-53) unchanged.

- [ ] **Step 5: Run to verify pass** — Step 2 command + existing `solution-session*.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C TODL add -A && git -C TODL commit -m "refactor(lsp): compose SolutionSession through the single resolver

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Analysis substrate classes — `Positions`, `SymbolKinds`, `DiagnosticsMapper`

**Files:**
- Create: `src/solution-services/lsp/analysis/positions.ts`, `.../symbol-kinds.ts`, `.../diagnostics-mapper.ts`
- Create tests: `src/solution-services/lsp/analysis/tests/positions.test.ts`, `symbol-kinds.test.ts`, `diagnostics-mapper.test.ts`

**Interfaces:**
- Produces: `class Positions { static SpanToRange(span): Range; static PositionToTodl(pos): TodlPosition; static RangeToSpan(uri, range): SourceSpan }`; `enum SymbolKind { … }` + `class SymbolKinds { static Of(model: Repository, id: NodeId): SymbolKind }`; `class DiagnosticsMapper { static Map(d): Diagnostic; static MapMany(ds): Diagnostic[] }` with a `private static readonly` severity map.

- [ ] **Step 1: Port the tests** — copy `src/language-service/tests/position*.test.ts`, `symbols*.test.ts`, `diagnostics*.test.ts` into the new `tests/` folder, rewriting call sites from free functions (`spanToRange(...)`) to the static methods (`Positions.SpanToRange(...)`). Keep every assertion identical.

- [ ] **Step 2: Run to verify fail** — Expected: FAIL (new classes absent).

- [ ] **Step 3: Port the implementations** — move the bodies from `position.ts` (8,16,21), `symbols.ts` (9-12 enum, 14), `diagnostics.ts` (5-8 map, 14, 25) into Allman-braced class methods. Keep logic verbatim; only change the call form to methods and hoist the `"todl"` source literal and `DOC_START` into `private static readonly` constants on `DiagnosticsMapper`.

- [ ] **Step 4: Run to verify pass** — Expected: PASS.

- [ ] **Step 5: Commit** (`refactor(lsp): OOP analysis substrate (Positions/SymbolKinds/DiagnosticsMapper)` + attribution).

---

### Task 5: `AnalysisSnapshot` + `ReferenceIndex` + `DefinitionIndex` classes

**Files:**
- Create: `src/solution-services/lsp/analysis/reference-index.ts`, `.../definition-index.ts`, `.../analysis-snapshot.ts`
- Create tests under `.../tests/`

**Interfaces:**
- Consumes: `Positions`, `SymbolKinds`, `DiagnosticsMapper` (Task 4), `checkAgainst` (compiler-services/api.js), `Repository`, `TodlDocument`, `SourceFile`.
- Produces:
  - `enum Role { … }`, `interface Occurrence { Uri; Range; Role; Symbol }`, `class ReferenceIndex { static Build(files: Map<string, NamespaceNode>): ReferenceIndex; Get(symbol): Occurrence[]; OccurrenceAt(uri, pos): Occurrence | null; All(): Occurrence[] }`.
  - `interface Definition { Symbol; Uri; NameRange; Kind: SymbolKind }`, `class DefinitionIndex { static Build(files): DefinitionIndex; Get(symbol): Definition | null; DefinitionAt(uri, pos): Definition | null; All(): Definition[] }`.
  - `class AnalysisSnapshot` (replaces `interface Analysis` + `analyze()`): `static Build(sources: readonly SourceFile[], bases?: readonly TodlDocument[]): AnalysisSnapshot`; readonly `Sources`, `Model: Repository`, `Refs: ReferenceIndex`, `Defs: DefinitionIndex`, `Diagnostics: readonly Diagnostic[]`, `DiagnosticsByUri: ReadonlyMap<string, readonly Diagnostic[]>`.

- [ ] **Step 1: Port tests** from `reference-index*.test.ts`, `definitions*.test.ts`, `analysis*.test.ts` into the new `tests/`, rewriting to `ReferenceIndex.Build(...)`, `DefinitionIndex.Build(...)`, `AnalysisSnapshot.Build(...)` and PascalCase members (`.Get`, `.OccurrenceAt`, `.DefinitionAt`, `.Refs`, `.Diagnostics`, `.DiagnosticsByUri`).

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Port implementations** — move bodies from `reference-index.ts` (enum 9, 20,39,75), `definitions.ts` (20 + private helpers), `analysis.ts` (`analyze` 28, interface 15-26). Preserve the null-span fan-out to every file (analysis.ts) and the longest-match/`contains` logic. Convert `interface Occurrence`/`Definition` field names to PascalCase. Keep `Role` as an `enum` (already is).

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit** (`refactor(lsp): OOP AnalysisSnapshot + reference/definition indexes` + attribution).

---

### Task 6: Context classifiers — `CursorClassifier`, `SchemaContextResolver`

**Files:**
- Create: `src/solution-services/lsp/analysis/cursor-classifier.ts`, `.../schema-context-resolver.ts` + tests.

**Interfaces:**
- Consumes: `AnalysisSnapshot` (Task 5).
- Produces: `enum ContextKind { … }`, `interface CursorContext { Kind; Word; Symbol?; OwnerConcept? }`, `class CursorClassifier { static ClassifyPosition(a: AnalysisSnapshot, uri, pos): CursorContext }`; `interface AssignmentContext { Concept; Member; TargetConcepts; Cardinality; IsRelationship }`, `class SchemaContextResolver { static AssignmentContextAt(a: AnalysisSnapshot, uri, pos): AssignmentContext | null }`.

- [ ] **Step 1: Port tests** (`classifier*.test.ts`, `schema-context*.test.ts`) → static-method call form + PascalCase fields.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Port implementations** from `classifier.ts` (enum 9-12, 22 + privates) and `schema-context.ts` (23 + privates), preserving the token-stream heuristics that survive parse errors. Hoist literal operators used as *markers in messages/labels* to constants; genuine structural tokens (`':'`, `'->'`, `'&'`, `'import'`) that are part of the lexing algorithm may stay inline per the house-rule carve-out.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** (`refactor(lsp): OOP cursor classifier + schema-context resolver` + attribution).

---

### Task 7: Providers — `NavigationProvider`, `HoverProvider`, `CompletionProvider`

**Files:**
- Create: `src/solution-services/lsp/analysis/navigation-provider.ts`, `.../hover-provider.ts`, `.../completion-provider.ts` + tests.

**Interfaces:**
- Consumes: `AnalysisSnapshot`, `CursorClassifier`, `SchemaContextResolver`, `Positions`, `SymbolKinds`.
- Produces:
  - `class NavigationProvider { DefinitionAt(a, uri, pos): Location | null; ReferencesAt(a, uri, pos, includeDecl: boolean): Location[] }`
  - `class HoverProvider { HoverAt(a, uri, pos): Hover | null }`
  - `class CompletionProvider { CompletionsAt(a, uri, pos): CompletionItem[] }`

- [ ] **Step 1: Port tests** (`navigation*.test.ts`, `hover*.test.ts`, `completion*.test.ts`) to `new NavigationProvider().DefinitionAt(a, …)` etc.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Port implementations** from `navigation.ts`, `hover.ts`, `completion.ts`, moving their module-private helpers (`symbolAt`, `KIND_LABEL`, `typeCandidates`, `conceptCandidates`, `KEYWORDS`, …) to private methods / `private static readonly` members on the owning class.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** (`refactor(lsp): OOP navigation/hover/completion providers` + attribution).

---

### Task 8: Providers — `RenameProvider`, `DocumentSymbolProvider`, `FoldingProvider`, `WorkspaceSymbolProvider`

**Files:**
- Create: `.../rename-provider.ts`, `.../document-symbol-provider.ts`, `.../folding-provider.ts`, `.../workspace-symbol-provider.ts` + tests.

**Interfaces:**
- Produces:
  - `interface RenameError { Error: string }`; `class RenameProvider { PrepareRename(a, uri, pos): Range | null; RenameEdits(a, uri, pos, newName): WorkspaceEdit | RenameError }`
  - `class DocumentSymbolProvider { Of(a, uri): DocumentSymbol[] }`
  - `class FoldingProvider { Of(a, uri): FoldingRange[] }`
  - `class WorkspaceSymbolProvider { Query(a, query: string): WorkspaceSymbol[] }`

- [ ] **Step 1: Port tests** (`rename*.test.ts`, `document-symbols*.test.ts`, `folding*.test.ts`, `workspace-symbols*.test.ts`).
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Port implementations** from `rename.ts` (const `KEBAB`→`private static readonly`), `document-symbols.ts`, `folding.ts`, `workspace-symbols.ts` (the `TO_LSP` map → `private static readonly`). Convert `RenameError.error`→`Error`.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** (`refactor(lsp): OOP rename/symbols/folding providers` + attribution).

---

### Task 9: Providers — `SemanticTokensProvider`, `SignatureHelpProvider`, `CodeActionProvider`, `FormattingProvider`

**Files:**
- Create: `.../semantic-tokens-provider.ts`, `.../signature-help-provider.ts`, `.../code-action-provider.ts`, `.../formatting-provider.ts` + tests.

**Interfaces:**
- Produces:
  - `class SemanticTokensProvider { static readonly Legend: SemanticTokensLegend; Of(a, uri): SemanticTokens }`
  - `class SignatureHelpProvider { SignatureHelpAt(a, uri, pos): SignatureHelp | null }`
  - `class CodeActionProvider { CodeActions(a, uri, range, diagnostics): CodeAction[] }`
  - `class FormattingProvider { static FormatText(text: string): string; FormatDocument(a, uri): TextEdit[] }`

- [ ] **Step 1: Port tests** (`semantic-tokens*.test.ts`, `signature-help*.test.ts`, `code-actions*.test.ts`, `formatting*.test.ts`). Where the server test referenced the exported `SEMANTIC_LEGEND`, point it at `SemanticTokensProvider.Legend`.
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Port implementations** from `semantic-tokens.ts` (`SEMANTIC_LEGEND` const → `static readonly Legend`; `TYPES`/`TYPE_INDEX`/`ROLE_TYPE` → private statics), `signature-help.ts` (`CARD`→private static), `code-actions.ts`, `formatting.ts`.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** (`refactor(lsp): OOP semantic-tokens/signature/code-actions/formatting providers` + attribution).

---

### Task 10: `AnalysisEngine` dispatcher + context protocol

**Files:**
- Create: `src/solution-services/lsp/analysis/protocol.ts`, `src/solution-services/lsp/analysis/analysis-engine.ts`, `src/solution-services/lsp/host/i-analysis-engine.ts`
- Create test: `src/solution-services/lsp/analysis/tests/analysis-engine.test.ts`

**Interfaces:**
- Consumes: all Task 7-9 providers, `AnalysisSnapshot` (Task 5), `SemanticTokensProvider.Legend`.
- Produces:
  - `protocol.ts`: `enum AnalyzeKind { Completion, Hover, Definition, References, PrepareRename, Rename, DocumentSymbols, Folding, WorkspaceSymbols, SemanticTokens, SignatureHelp, CodeActions, Formatting, Diagnostics }`; `interface AnalyzeContext { BaseSetToken: number; Bases?: readonly TodlDocument[]; Documents: readonly SourceFile[] }`; `interface AnalyzeRequest { Kind: AnalyzeKind; Uri: string; Position?: Position; Range?: Range; Diagnostics?: readonly Diagnostic[]; NewName?: string; Query?: string; IncludeDeclaration?: boolean; Context: AnalyzeContext }`; a tagged `AnalyzeResponse` union keyed by `Kind` (each carrying the matching provider return type).
  - `i-analysis-engine.ts`: `interface IAnalysisEngine { Analyze(request: AnalyzeRequest): Promise<AnalyzeResponse>; }` + `const AnalysisEngineKey = new ServiceKey<IAnalysisEngine>('AnalysisEngine')`.
  - `analysis-engine.ts`: `class AnalysisEngine implements IAnalysisEngine` — holds one instance of each provider; caches `lastToken: number` + `lastBases: readonly TodlDocument[]`; on `Analyze`, if `request.Context.Bases` is present it refreshes the cache and the token, else it reuses `lastBases` only when `request.Context.BaseSetToken === lastToken` (otherwise it rejects with a `StaleBaseSet` error so the host re-sends); builds an `AnalysisSnapshot.Build(Documents, bases)` and routes to the provider for `Kind`, returning the tagged response.

- [ ] **Step 1: Write the failing tests**

```ts
test('each AnalyzeKind routes to the matching provider', async () =>
{
    const engine = new AnalysisEngine()
    const ctx = { BaseSetToken: 1, Bases: [], Documents: [oneConceptDoc] }
    const r = await engine.Analyze({ Kind: AnalyzeKind.Completion, Uri: oneConceptDoc.uri, Position: pos, Context: ctx })
    assert.equal(r.Kind, AnalyzeKind.Completion)
    assert.ok(Array.isArray(r.Items))
})

test('base-set token suppresses re-sending unchanged bases', async () =>
{
    const engine = new AnalysisEngine()
    await engine.Analyze({ Kind: AnalyzeKind.Diagnostics, Uri, Context: { BaseSetToken: 7, Bases: [baseDoc], Documents } })
    // second call omits Bases but reuses token 7 → must succeed from the cached base-set
    const r = await engine.Analyze({ Kind: AnalyzeKind.Diagnostics, Uri, Context: { BaseSetToken: 7, Documents } })
    assert.equal(r.Kind, AnalyzeKind.Diagnostics)
})

test('a stale token without bases is rejected so the host re-sends', async () =>
{
    const engine = new AnalysisEngine()
    await engine.Analyze({ Kind: AnalyzeKind.Diagnostics, Uri, Context: { BaseSetToken: 7, Bases: [baseDoc], Documents } })
    await assert.rejects(() => engine.Analyze({ Kind: AnalyzeKind.Diagnostics, Uri, Context: { BaseSetToken: 8, Documents } }), /StaleBaseSet/)
})
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement `protocol.ts`, `i-analysis-engine.ts`, `analysis-engine.ts`** per the Interfaces block. Route each `Kind` with a `switch` (Allman). Hoist `'StaleBaseSet'` to a `private static readonly` constant.

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit** (`feat(lsp): AnalysisEngine dispatcher + context protocol` + attribution).

---

### Task 11: Host session model — port `ProjectRegistry` + `SourceProvider` + `PushedSourceProvider`

**Files:**
- Create: `src/solution-services/lsp/host/project-registry.ts` (from `language-server/workspace.ts`)
- Create test: `src/solution-services/lsp/host/tests/project-registry.test.ts` (from `language-server/tests/workspace.test.ts` + `source-providers.test.ts`)

**Interfaces:**
- Produces: `interface Project { RootUri; Bases: TodlDocument[]; Snapshot: AnalysisSnapshot | null; Dirty: boolean }`; `class ProjectRegistry { Register(rootUri): Project; SetBases(rootUri, bases): void; ProjectFor(uri): Project | null; MarkDirty(rootUri): void; DirtyProjects(): Project[]; All(): Project[]; Remove(rootUri): void }`; `interface SourceProvider { InitialRoots(folders: string[]): string[]; SourcesFor(project: Project, openDocs): SourceFile[] }`; `class PushedSourceProvider implements SourceProvider`.

- [ ] **Step 1: Port tests** — rewrite to PascalCase methods and `Snapshot` (was `analysis`).
- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Port implementation** from `workspace.ts` (ProjectRegistry 16-57, SourceProvider 59-65, PushedSourceProvider 68-77). Keep the **longest-prefix** `ProjectFor` rule (returns `null` for an unmatched URI — Review Focus item 5). Rename `analysis`→`Snapshot`, field/method casing to PascalCase. Do NOT port `FsSourceProvider` / `workspace-fs.ts` (Node-only; dropped — see Task 15).
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** (`refactor(lsp): port ProjectRegistry + pushed source provider to host half` + attribution).

---

### Task 12: `SolutionLanguageService` (host half) + `ILanguageService`

**Files:**
- Create: `src/solution-services/lsp/host/i-language-service.ts`, `src/solution-services/lsp/host/solution-language-service.ts`
- Create test: `src/solution-services/lsp/host/tests/solution-language-service.test.ts`

**Interfaces:**
- Consumes: `SolutionSession` + `SolutionBaseResolver` (Tasks 1-3), `ProjectRegistry` (Task 11), `IAnalysisEngine`/`AnalysisEngineKey`/`AnalyzeKind`/`AnalyzeRequest` (Task 10), `SolutionManagerService.Key`, `IServiceProvider`, `ServiceBase`.
- Produces:
  - `i-language-service.ts`: `interface ILanguageService { CompletionsAt(uri, pos): Promise<CompletionItem[]>; HoverAt(uri, pos): Promise<Hover | null>; DefinitionAt(uri, pos): Promise<Location | null>; ReferencesAt(uri, pos, includeDecl): Promise<Location[]>; PrepareRename(uri, pos): Promise<Range | null>; RenameEdits(uri, pos, newName): Promise<WorkspaceEdit | RenameError>; DocumentSymbols(uri): Promise<DocumentSymbol[]>; FoldingRanges(uri): Promise<FoldingRange[]>; WorkspaceSymbols(query): Promise<WorkspaceSymbol[]>; SemanticTokens(uri): Promise<SemanticTokens>; SignatureHelpAt(uri, pos): Promise<SignatureHelp | null>; CodeActions(uri, range, diagnostics): Promise<CodeAction[]>; FormatDocument(uri): Promise<TextEdit[]>; DidChange(uri, text): void; DiagnosticsFor(uri): Promise<Diagnostic[]> }`.
  - `solution-language-service.ts`: `class SolutionLanguageService extends ServiceBase implements ILanguageService` with `static readonly Key = new ServiceKey<SolutionLanguageService>('SolutionLanguageService')`. Constructor resolves the engine (`Provider.get(AnalysisEngineKey)`, defaulting to a new in-process `AnalysisEngine`), builds/holds the `SolutionSession` over the resolver, holds a `ProjectRegistry`, and eagerly builds the warm cache. Maintains a monotonic `baseSetToken` (bumped by Task 13). Each feature method resolves the project for the URI (returns empty/null if none — Review Focus 5), assembles an `AnalyzeContext` from the warm bases + live buffer (full bases only when the token changed since the last send *per project*), and awaits `engine.Analyze`, unwrapping the tagged response.

- [ ] **Step 1: Write the failing tests**

```ts
test('CompletionsAt returns the engine result for an in-project document', async () =>
{
    const svc = makeServiceOverSolution(solutionWithConsumer)
    svc.DidChange(consumerUri, 'concept foo { }')
    const items = await svc.CompletionsAt(consumerUri, somePos)
    assert.ok(Array.isArray(items))
})

test('a request for a URI under no project root returns empty, does not throw', async () =>
{
    const svc = makeServiceOverSolution(solution)
    assert.deepEqual(await svc.CompletionsAt('file:///outside/x.todl', pos), [])
    assert.equal(await svc.HoverAt('file:///outside/x.todl', pos), null)
})

test('the full base-set is sent when the token changed, then suppressed', async () =>
{
    // spy on the injected IAnalysisEngine: first request after a token bump carries Context.Bases; the next does not.
})
```

- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** `ILanguageService` + `SolutionLanguageService` per the Interfaces block. Allman; no inline literals; teardown via `dispose()` (unsubscribe placeholder filled in Task 13).
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** (`feat(lsp): SolutionLanguageService host half over the warm cache` + attribution).

---

### Task 13: Incremental lifecycle cache maintenance

**Files:**
- Modify: `src/solution-services/lsp/host/solution-language-service.ts`
- Modify (if needed): `src/solution-services/solution-manager/engine/solution-base-resolver.ts` (stop the coarse `clearCache` on every Members change; keep it only for solution switch)
- Create test: `src/solution-services/lsp/host/tests/lifecycle-maintenance.test.ts`

**Interfaces:**
- Consumes: `Solution.Members` `ObservableCollection.Subscribe` (payload `CollectionChange` with `kind` `'inserted'|'removed'|…`), `ProjectEventsKey` + `ProjectEventKind.ReferencesChanged`, `ProjectContentStore.ObserveChildren` (`ContentAdded`/`ContentUpdated`/`ContentRemoved`), `SolutionBaseResolver.Invalidate(memberId)` + `StaleMemberIds`.
- Produces: `SolutionLanguageService` subscriptions (stored as `IDisposable`s, torn down in `dispose()`), each firing a targeted `resolver.Invalidate(memberId)` and a `baseSetToken` bump.

- [ ] **Step 1: Write the failing tests**

```ts
test('removing a member evicts it and its dependents only', async () =>
{
    // A depends on B; remove B.
    svc // triggers Members 'removed' for B
    assert.deepEqual([...resolver.StaleMemberIds].sort(), ['A', 'B'].sort())
})

test('a reference change on one member evicts only that member + dependents', async () => { /* ProjectEventKind.ReferencesChanged */ })

test('a file add under a member evicts only that member + dependents and bumps the token', async () =>
{
    const before = svc.BaseSetToken
    // ContentAdded under member C (no dependents)
    assert.deepEqual([...resolver.StaleMemberIds], ['C'])
    assert.ok(svc.BaseSetToken > before)
})

test('dispose() unsubscribes (no eviction after dispose)', async () => { /* ... */ })
```

- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement** the subscriptions in `SolutionLanguageService` (Allman; map each event to the touched `memberId`, call `resolver.Invalidate`, bump token). Replace the resolver's `rewireMembers`→`clearCache`-on-any-Members-change with targeted invalidation; retain `clearCache` only for the `ActiveSolution` switch. Store unsubscribe thunks as `IDisposable` and dispose them.
- [ ] **Step 4: Run to verify pass** + resolver suite regression.
- [ ] **Step 5: Commit** (`feat(lsp): incremental lifecycle cache maintenance` + attribution).

---

### Task 14: `lsp-module.mu` + composition root + index/package exports

**Files:**
- Create: `src/solution-services/lsp/lsp-module.mu` (compiles to `lsp-module.mu.js`)
- Create: `src/solution-services/lsp/index.ts` (barrel re-exporting the public surface)
- Create tests: `src/solution-services/lsp/tests/lsp-test-composition-root.mu` + `.ts` + `lsp-module.test.ts` (mirror the `solutions-test-composition-root` trio)
- Modify: `src/index.ts` (re-export `LspServicesEngine` next to line 180); `package.json` (add `"./solution-services/lsp"` export mirroring the existing `./solution-services/*` exports at package.json:33-72)

**Interfaces:**
- Consumes: `SolutionLanguageService` (Task 12), `AnalysisEngine`/`AnalysisEngineKey` (Task 10), the `.mu module` pattern from `solution-services-module.mu`.
- Produces: `export const LspServicesEngine` (a `Module`).

- [ ] **Step 1: Author `lsp-module.mu`** mirroring `solution-services-module.mu` exactly — default `.js` imports, `module LspServicesEngine { .services: { SolutionLanguageService  AnalysisEngine -> AnalysisEngineKey } }` (bare entry registers by `static Key`; arrow entry registers the in-process engine under its interface key).
- [ ] **Step 2: Compile** — Run: `npm --prefix TODL run compile:mu`. Expected: emits `src/solution-services/lsp/lsp-module.mu.js`.
- [ ] **Step 3: Write the failing composition test** — `lsp-module.test.ts` calls `create()` from the test root and asserts `root.Provider.getRequired(SolutionLanguageService.Key) instanceof SolutionLanguageService` (register host seams — storage, package store, `SolutionManagerService` — on the provider first, per the `solutions-test-composition-root` pattern).
- [ ] **Step 4: Run to verify fail**, then add the `src/index.ts` re-export and the `package.json` export, run `npm --prefix TODL run compile:mu` if the test root `.mu` changed, and run to verify **pass**.
- [ ] **Step 5: Commit** (`feat(lsp): LspServicesEngine module + composition + exports` + attribution).

---

### Task 15: Remove the old root folders, exports, bin, and dead transport

**Files:**
- Delete: `src/language-service/**`, `src/language-server/**` (incl. `stdio.ts`, `server.ts`, `workspace.ts`, `workspace-fs.ts`, their `index.ts`, and all `language-server/tests/**` + `language-service/tests/**` now re-homed under `lsp/`)
- Modify: `package.json` — remove `exports["./language-service"]`, `exports["./language-server"]`, and the `bin` block (todl-language-server)
- Modify: any `src/index.ts` re-exports that pointed at the removed barrels

**Interfaces:**
- Consumes: nothing new. This is deletion + export surgery.
- Produces: `src/language-service` and `src/language-server` no longer exist; the only language surface is `./solution-services/lsp`.

- [ ] **Step 1: Grep for internal importers** of `@pragmatic-tech-ai/todl/language-service`, `/language-server`, and relative `../language-service`/`../language-server` paths within TODL; confirm the only remaining references are the files being deleted. (Plexus references are external and intentionally break until Wave 2 — do not touch Plexus here.)
- [ ] **Step 2: Delete** the two folders and remove the `package.json` exports + `bin`.
- [ ] **Step 3: Run the full gate** — `npm --prefix TODL run build` (gen:prelude + gen:scaffold + compile:mu + tsc) then `npm --prefix TODL test`. Expected: tsc clean; full suite green (the re-homed `lsp/**/tests` carry the former coverage).
- [ ] **Step 4: Fix any dangling references** surfaced by tsc (dead `src/index.ts` lines), re-run the gate to green.
- [ ] **Step 5: Commit** (`refactor(lsp)!: remove language-service/language-server roots, bin, and stdio transport` + attribution).

---

### Task 16: Version bump, publish, and register the plan

**Files:**
- Modify: `TODL/package.json` (version bump)

**Interfaces:**
- Consumes: the green Task 15 tree.
- Produces: a published todl release on GitHub Packages; this plan registered in the Project.

- [ ] **Step 1: Bump** `TODL/package.json` version (minor — new module surface + breaking export removal; choose per current version). Confirm `prepublishOnly` runs clean + build.
- [ ] **Step 2: Publish** — Run: `npm --prefix TODL publish` (GitHub Packages via the repo's `.npmrc`; `prepublishOnly` rebuilds). Do **not** upgrade Plexus against it (Wave 2).
- [ ] **Step 3: Register this plan in the Project** — create a draft issue from this file and set Kind=Plan:

```bash
gh api graphql -f query='mutation($p:ID!,$t:String!,$b:String!){addProjectV2DraftIssue(input:{projectId:$p,title:$t,body:$b}){projectItem{id}}}' \
  -f p=PVT_kwDOE0Zc984Biu4o -f t="[TODL] LSP solution-services/lsp — Wave 1 Plan" \
  -F b=@TODL/docs/superpowers/plans/2026-10-04-lsp-solution-services-wave1.md
# then set Kind=Plan (option 7fcc7a4d) on the returned item id:
gh api graphql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}' \
  -f p=PVT_kwDOE0Zc984Biu4o -f i=<ITEM_ID> -f f=PVTSSF_lADOE0Zc984Biu4ozhhmtQM -f o=7fcc7a4d
```

- [ ] **Step 4: Commit** (`chore(lsp): release todl Wave 1` + attribution) and push (push-and-stop; do not watch CI).
