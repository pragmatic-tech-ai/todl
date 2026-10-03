# LSP as a `solution-services/lsp` Module — Design

**Status:** Draft for review
**Date:** 2026-10-03
**Supersedes (in part):** `2026-09-27-solution-base-resolver-design.md` (the resolver's ownership and the live-member compile path change here)
**Related:** todl#15 (future JSON-RPC proxy), plexus#5 (C2 deferreds — unrelated)

## Goal

Make the TODL language service a single, solution-scoped **module** that owns the
one symbol resolver and serves all language features, so that **unpublished
in-solution member projects contribute their symbols** and the editor stays
**responsive** (analysis off the UI thread, I/O minimized). Plexus becomes a pure
consumer that holds no resolver of its own.

## Why (the defect this fixes)

A live probe against the `plexus_test_projects` corpus shows every project resolving
**0 bases**, with problems like:

```
local library "microsoft" — project "microsoft" (library) has no publishable version
library "microsoft@0.1.0" is not published
```

Root cause: `SolutionBaseResolver` contributes an in-solution member's symbols by
compiling it through the **publish** path — `ProjectModelProvider.CompileWithBases`
→ `compilePackage` with an identity built by `toPackageJson`, whose
`packageVersion(manifest)` **throws** when the member has no publishable version.
The throw is caught, resolution falls through to the published package store, the
member isn't published → the base is **dropped**. A consumer (`landscape.todl`) then
resolves none of its meta-model/library concepts → a wall of "unresolved" errors and
empty arch diagrams. An unpublished sibling can only contribute symbols if it also
happens to be publishable — which contradicts the resolver's own stated intent
("an unpublished sibling still resolves").

Two deeper problems sit behind it: symbol resolution is **fragmented** (the LSP path
via `SolutionBaseResolver`; the `SolutionSession`/`Domain` composition via a
*published-only* source; the out-of-process stdio server's own base set), and Plexus
**holds resolvers** in several renderer services instead of deferring to one
authority.

## Design principle

**Minimize I/O to keep the editor responsive.** The symbol cache is built once on
linkage and maintained **incrementally** from solution lifecycle events; file reads
happen only while building/adjusting the cache, never per keystroke; at request time
the analysis context is assembled from the **warm in-memory cache** plus the live
editor buffer. The client never triggers base resolution — only document sync and
feature requests.

## Architecture overview

A new module `src/solution-services/lsp/` — a `.mu module` (same pattern as
`SolutionServicesEngine` in `solution-services-module.mu`) whose `.services:` block
registers the language service into the host's service provider. The module has two
cooperating halves split by responsibility:

```
          ┌───────────────────────── solution-services/lsp (module) ─────────────────────────┐
 Monaco   │  HOST HALF  (main/renderer thread — state + I/O)        WORKER HALF (web worker)  │
 providers│  ┌───────────────────────────────────────────┐         ┌───────────────────────┐ │
   ───────┼─▶│ ILanguageService  (registered service)     │  ctx    │ pure language-service  │ │
 feature  │  │  • SolutionSession → SolutionBaseResolver   │ ──────▶ │  completion/hover/…    │ │
 requests │  │    (the ONE resolver: live members + store) │         │  diagnostics/rename/…  │ │
          │  │  • warm symbol cache (composed Domain)      │ ◀────── │  (stateless, CPU-bound)│ │
 didChange│  │  • lifecycle-event cache maintenance        │ result  └───────────────────────┘ │
   ───────┼─▶│  • owns ALL file reads                      │                                    │
          │  └───────────────────────────────────────────┘                                    │
          └──────────────────────────────────────────────────────────────────────────────────┘
```

The **host half** owns state and I/O; the **worker half** is pure, stateless
analysis. Only the analysis crosses the worker boundary.

## Components

### 1. The `lsp` module (`solution-services/lsp/lsp-module.mu`)

A plain `module` with a `.services:` block registering the host-half service class
(and any supporting keys). Lowers to a `Module` that replays its registrations into
whatever container composes it (a shell, a CLI, a test harness) — identical to
`SolutionServicesEngine`. A host lists it in its `.modules:` block; no app-specific
wiring beyond the seams the module declares (storage, package store, the active
solution).

### 2. Host half — `SolutionLanguageService` (main/renderer thread)

The registered service and the single symbol authority.

- **On linkage to the solution (construction), eagerly builds the cache.** It owns a
  durable `SolutionSession` (one per open solution) that **constructs the single
  `SolutionBaseResolver`**, injecting the two solution-scoped sources: in-solution
  member projects (raw `.todl`, live-first) and the published package store
  (`PackageStoreKey`, the `inner()` fallback). The session composes the `Domain` and
  caches it.
- **Owns all file reads.** The worker cannot touch disk, so every read — member
  sources for the cache, published package bytes — happens here.
- **Tracks solution lifecycle events and adjusts the cache incrementally** (never a
  blind full rebuild):
  - *project added / removed* — `Solution.Members` is an `ObservableCollection`;
    subscribe to its collection-changed events.
  - *references added / removed* — a member's manifest `metaModels`/`libraries`
    bindings change (via the reference-editing path); re-resolve only that member's
    base subtree and its dependents.
  - *files added / removed / changed* — the `ProjectContentStore` watch events;
    recompile only the touched member (and transitive dependents), reusing the
    existing `StaleMemberIds`/`Invalidate` eviction graph the resolver already keeps.
- **Prepares the analysis context** for the worker: the cached resolved
  bases/symbols for the active document's project plus the current buffer text. No
  file read at request time — the cache is warm.
- **Exposes the LSP surface** (`ILanguageService`) with promise-returning methods —
  which is exactly what Monaco's provider API already expects.

### 3. Worker half — pure analysis

The existing `language-service/*` functions run here unchanged in spirit: stateless,
taking `(document, position, context)` and returning results. The worker holds no
state and does no I/O; it receives a prepared context + document from the host, runs
the CPU-bound pass (completion, diagnostics, hover, definition, references, rename,
semantic tokens, folding, formatting, …), and returns the result.

### 4. Host ↔ worker context protocol

A thin typed message channel (structured-clone `postMessage`, same origin — not
process serialization, not JSON-RPC):

- `analyze(kind, document, position?, context)` → result (completion list, hover,
  locations, edits, diagnostics, …). One request/response shape per feature, or one
  tagged union.
- The **context** carries the cached base documents/symbols the pass needs. To keep
  messages small, the host sends a base-set **version token**; the worker caches the
  last base-set it received and the host re-sends the full set only when the token
  changes (i.e. after a lifecycle event), not on every keystroke. (Minimize I/O and
  marshaling — the warm path sends only the small active buffer + token.)

### 5. Version-free member compile (the root-cause fix)

In-solution symbol contribution must not require a publishable version. Add a
version-free compile path used by the resolver's live-member branch:

- `ProjectModelProvider` gains a compile that produces the member's **document /
  symbols** with a **synthetic local identity** (e.g. `version: "0.0.0-local"` or a
  dedicated marker) instead of calling `toPackageJson` → `packageVersion`. Since
  `compilePackage` only *stamps* the identity into package metadata and never binds
  against it (verified), the resulting symbols are identical to a published compile.
- The synthetic version is confined to in-solution resolution and **never reaches a
  published artifact** — `publish()` keeps its own real-version path untouched; a
  missing publishable version is still an error *at publish time*.
- The existing non-fatal `versionMismatch` warning stays for the published-fallback
  branch.

## Data flow

- **Startup / solution open:** host constructs → eager cache build (resolve + compose
  Domain) → ready. One burst of I/O, then warm.
- **Edit (`didChange`):** host updates the active document's buffer; if the edit
  changes a *member that others depend on*, it invalidates that member's cache slice
  (incremental); then (debounced) it dispatches the affected document(s) to the
  worker; worker returns diagnostics; host surfaces them. No cross-project re-read
  unless a dependency actually changed.
- **Feature request (completion/hover/…):** host assembles context from the warm
  cache + live buffer (no read), posts to the worker, awaits, returns to Monaco.
- **Lifecycle event (project/reference/file add-remove):** host adjusts the cache
  incrementally (reads only what changed), bumps the base-set token, lets the next
  analysis pick up the new context.

## Migration (todl root folders emptied)

- **Move** `src/language-service/*` (pure analysis) into the worker side of
  `src/solution-services/lsp/`.
- **Move** the transport-free parts of `src/language-server/*` — the workspace/session
  model (`workspace.ts`, the non-stdio server logic) — into the host side of
  `src/solution-services/lsp/`.
- **Remove** the out-of-process stdio transport (`stdio.ts`, `server.ts`,
  `workspace-fs.ts`) from the root. The dedicated JSON-RPC server returns later as a
  thin **proxy** over this module — tracked as **todl#15**, explicitly deferred.
- **Result:** `src/language-service` and `src/language-server` are **empty** (removed).
- `SolutionBaseResolver` stops being an independently-registered `ServiceKey` service
  that reaches into `ActiveSolution` on its own; the session injects its inputs, so it
  is in sync by construction.
- `SolutionSession.compose` stops using the published-only source; it composes through
  the one resolver (live members + published), so `ComposeDiagnostics` and the LSP see
  the same symbol universe.

## Plexus adoption (consumer)

- **Host the `lsp` module in the renderer**; spin up the analysis web worker; register
  `ILanguageService`. Monaco's providers call the registered service directly
  (promise-based), with the worker doing the analysis.
- **Remove every renderer resolver.** `TodlLanguageClient`'s stdio/JSON-RPC transport
  and `setBases`/`refreshBases` push are deleted; the vendored stdio server
  (`scripts/build-todl-server.mjs` + `out/main/todl-language-server.cjs`) is removed;
  the renderer services that resolve `SolutionBaseResolver.Key` today
  (`arch-model-gateway`, `architecture-model-service`, `project-explorer`) route
  through the session/service. **Plexus holds no resolver.**
- The published-only IPC composition source and any now-dead wiring are removed.

## Waves

1. **todl engine:** create `solution-services/lsp` module; migrate analysis (worker)
   + session/workspace (host); session-owned single resolver; version-free compile;
   host↔worker context protocol; lifecycle-event cache maintenance; empty the root
   folders. Publish a todl release.
2. **Plexus adoption:** host the module in-renderer + worker; wire Monaco to the
   registered service; delete the stdio client/server and the renderer resolvers;
   route arch-model/project-explorer through the service.
3. **Cleanup:** remove the IPC published-only composition path and dead wiring; verify
   via the e2e corpus that bases resolve and diagnostics/arch diagrams populate.

## Global constraints

- **House style** across both repos: OOP (no module-level free functions / data —
  note the current `language-service/*` are free functions; migrating them into the
  module is the moment to make them methods on cohesive analysis classes), Allman
  braces, no inline reused/user-facing string literals (hoist to
  `private static readonly`), real enums over string unions, `IDisposable` teardown,
  VMs extend `Observable`, PascalCase interfaces + public methods.
- **Publishing keeps a real version.** The version-free compile is strictly for
  in-solution resolution; `publish()` still requires and stamps a real version.
- **Minimize I/O / responsiveness** is a design acceptance criterion, not a nice-to-
  have: no per-keystroke file reads; incremental, not full, cache updates.
- **Latest packages**: adopt the newest todl/mural across the workspace per standing
  preference.

## Non-goals / deferred

- **Dedicated JSON-RPC LSP server** — a thin proxy over this module for external
  editors; **todl#15**, not now.
- **Large-workspace tuning** beyond the warm-cache + incremental-update design
  (e.g. partial semantic-token streaming) — revisit only if measured.

## Testing strategy

- **Version-free compile (unit, todl):** a member manifest with no publishable
  version compiles to a document with the synthetic identity and the expected
  symbols; `publish()` on the same manifest still errors.
- **Resolver (unit, todl):** an unpublished in-solution member contributes its
  symbols to a consumer's bases (the exact probe that showed 0 bases now shows the
  member's symbols); published fallback still works; version mismatch still warns.
- **Lifecycle maintenance (unit, todl):** project add/remove, reference add/remove,
  file add/remove each adjust the cache incrementally (only the touched member +
  dependents recompile), asserted via the eviction set.
- **Host↔worker protocol (unit, Plexus):** a feature request marshals context and
  returns the worker's result; the base-set token suppresses re-sending unchanged
  bases on plain edits.
- **Live e2e (Plexus):** against `plexus_test_projects`, the arch project resolves
  its bases (no "not published" / "no publishable version" problems), the problems
  count is validation-only, and `diagram-2` renders its nodes. The smoke boot gate
  stays clean.

## Risks / open questions

- **Synthetic version identity collisions** in a cache keyed by `id@version` — the
  local marker must be distinct from any real version and per-member stable within a
  session.
- **Worker warm-up latency** on first analysis after startup — acceptable given the
  eager cache build; measure if it bites.
- **True synchronous reads** aren't available in a renderer (I/O is async over IPC);
  "host owns the reads" means the host performs them while maintaining the cache on
  lifecycle events, so they're off the request path — not that they are literally
  synchronous. The responsiveness guarantee comes from the warm cache, not from sync
  I/O.
