# SolutionBaseResolver + generator base-resolution — design (Wave 1)

> **Kind:** Design spec · **Repo:** TODL (`@pragmatic-tech-ai/todl`), with a one-line composer wiring consumed by Plexus · **Date:** 2026-09-27

## Goal

Give TODL's content generators (and, later, validation) base models resolved
from the **open solution's live member sources**, not only from published
packages. Today a project bound to a sibling that is open but not yet
published generates nothing, because the generator's `IPackageSource` is the
published package store. This wave introduces `SolutionBaseResolver` — a TODL
`IPackageSource` that layers live compiles of open solution members over the
published source — and wires the composer's generator context to it.

This is Wave 1 of a larger effort ("move base resolution and its neighbors
into `solution-services`; Plexus adopts `solution-services` wholesale").
Waves 2 (wiki + reference/base-binding model) and 3 (ProjectExplorerService →
wrapper over `SolutionManagerService`; language-client re-subscription) are
out of scope here and get their own specs.

## Background

- `ProjectModelProvider.ResolveBases` resolves a project's declared bindings
  through a single injected `IPackageSource` via
  `RecursiveProjectReferencesResolver.Resolve(source, bindings)`.
- `ProjectSystemComposer` builds the generator `GeneratorContext` per event
  (`Created`/`Opened`/`ReferencesChanged`) and resolves that source lazily:
  `ResolveSource(provider, explicit) = explicit ?? provider.get(PackageStoreKey) ?? EmptyPackageSource`.
  `PackageStoreKey` (in Plexus, `PlexusPackageStore`) reads the published
  packages backend only — hence the gap.
- Plexus's host-side `WorkspaceBaseResolver` already does live-first
  resolution, but keyed off the explorer's open projects and welded to host
  types (`ProjectExplorerService`, `TodlLanguageClient`, mural `ServiceBase`,
  wiki-origin). It cannot move as-is; TODL must stay host-free.
- `SolutionManagerService` is TODL's native "open set": `Members` is an
  `ObservableCollection<SolutionMember>`; each member has a `Ref` (path +
  type) and a `Project` handle set by `Solution.OpenMembers`. The member's
  rooted `IStorage` is created inside `OpenMembers` (`storageFor(rel)`) and
  currently discarded.

## Non-goals

- No change to what generators produce, to the compiler, or to publish.
- No move of wiki-origin, base-binding, reference-node, or the explorer in
  this wave.
- The editor/LSP re-validation mechanism stays host-side; this wave only
  defines and raises the stale-member signal. No host subscriber is built
  here.
- No unification of "explorer open projects" with "solution members" (Wave 3).

## Global constraints (house style)

OOP (no free functions / module-level mutable state; behavior on classes),
Allman braces, PascalCase interfaces + public methods, enums over
string-literal unions, no inline string literals (hoist to
`private static readonly`), view models extend `Observable`, tests in a
`tests/` subfolder next to source. TODL depends on `@pragmatic-tech-ai/mural`
but on no host application. Commit attribution:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Section 1 — SolutionMember gains Storage

`SolutionMember` (solution-manager/engine/solution-member.ts) gains a public
`Storage: IStorage | undefined`, set in `Solution.OpenMembers` alongside
`Project` (the storage is already built there via `storageFor(ref.path)` —
stash it instead of discarding it). `undefined` for an unresolved member (a
type with no registered factory), matching `Project`'s contract.
`SolutionMember` stays an `Observable`; `Storage` is a plain settable field
(infrastructure, not bound UI), so no `RaisePropertyChanged` is required
unless a consumer binds it.

## Section 2 — SolutionBaseResolver

New class `solution-services/solution-manager/engine/solution-base-resolver.ts`,
extends `todl-runtime` `ServiceBase`, implements `IPackageSource`. Registered
under a `SolutionBaseResolver.Key` (`ServiceKey<SolutionBaseResolver>`).

Constructor takes the provider; it resolves `SolutionManagerService` and an
**inner published source** (`PackageStoreKey`) lazily. The inner source is
whatever the host registered under `PackageStoreKey`; when none is present the
resolver behaves as published-empty (live-only).

```ts
public async TryGet(ref: PackageRef): Promise<SourcedPackage | undefined>
```

Behavior:

1. Find an open, **resolved** solution member (`member.Storage !== undefined`)
   whose parsed manifest is a producer (`ProjectType.MetaModel` or
   `ProjectType.Library`) and whose manifest `id === ref.id`.
2. If found and not already on the current resolution path (cycle guard by
   member id, DFS add-on-entry / remove-on-exit — genuine cycles blocked,
   diamonds allowed), compile it live:
   `new ProjectModelProvider(member.Storage, memberManifest, this).Compile()`
   — passing `this` so the member's own bases resolve through the same
   live-first path. On success, return
   `{ Document: package.document, Dependencies: package.dependencies }` as a
   `SourcedPackage`. On live-compile failure, fall through to the inner
   published source (best-effort — a previously-published good version still
   works).
3. A live member matching by id is preferred regardless of a
   `version !== ref.version` mismatch (matching today's live-first behavior).
4. Otherwise delegate: `return this.inner.TryGet(ref)`.

The resolver never compiles the consumer itself (self-exclusion by the
resolution-path guard). Reads a member's manifest from `member.Storage` via
the manifest filename constant (hoisted).

**Problem-surfacing boundary.** `IPackageSource.TryGet` returns
`SourcedPackage | undefined` with no problems channel, so a live-compile
failure or version mismatch is not reported *through this seam* in Wave 1: a
matched-but-uncompilable member that also has no published fallback simply
returns `undefined`, and `RecursiveProjectReferencesResolver` records it as an
unresolved base through its own problem list, exactly as an absent published
ref is recorded today. The richer per-binding diagnostics Plexus's host
resolver produced (version-mismatch warnings, per-base "not published"
messages tagged by kind) are a Wave 3 concern, when the host resolver becomes
the wrapper that owns that reporting.

## Section 3 — Cache, dependency graph, stale signal

- **Cache:** a per-member `Map<memberId, SourcedPackage>` of live compiles. A
  cached compile is kept until invalidated. Wave 1 invalidation triggers are:
  (a) any `SolutionManagerService.Members`-collection change (add/remove), and
  (b) an explicit `Invalidate(memberId)` method the resolver exposes. There is
  no per-keystroke source-change hook inside TODL in this wave — a member's
  in-editor edits are known only host-side, so the host calls `Invalidate`
  (Wave 3); within Wave 1 the API exists and is unit-tested, driven explicitly.
- **Dependency graph:** built from member manifests' `metaModels`/`libraries`
  bindings — `dependentsOf(id)` = members whose bindings reference `id`,
  transitively. Rebuilt incrementally when a member is added/removed rather
  than a full teardown.
- **Stale signal:** `StaleMembers` — an `Observable` event (via
  `RaisePropertyChanged` on a `StaleMemberIds` property, or an explicit
  lightweight signal consistent with the codebase's push-signal convention)
  carrying the set of member ids whose resolution just changed. The resolver
  raises it on invalidation. No subscriber is built in this wave; the host
  (Wave 3) subscribes to drive editor re-validation and coalesces bursts.

Rationale (performance): precise transitive-dependent invalidation avoids
recompiling unaffected members; a push signal lets the host batch a burst of
producer edits into one refresh pass and never blocks TODL on editor latency.

## Section 4 — Generator wiring

`ProjectSystemComposer.ResolveSource(provider, explicit)` becomes:

```
explicit
  ?? (SolutionManagerService registered
        ? new SolutionBaseResolver(provider)   // composes over PackageStoreKey
        : provider.get(PackageStoreKey))
  ?? EmptyPackageSource
```

Still evaluated per event (lazy), so a `SolutionManagerService` /
`PackageStoreKey` registered after composition is still reached. Headless
hosts (CLI/smoke) without a `SolutionManagerService` fall back to the
published store or empty exactly as today — no behavior change there.

The composer may instead resolve a registered `SolutionBaseResolver.Key`
instance when present (so the host and generators share one resolver +
cache); the implementer picks whichever keeps a single resolver instance per
container with least churn, and records the choice.

## Section 5 — Scope boundary

Live resolution keys off `SolutionManagerService.Members`. Until Wave 3 makes
the explorer a wrapper over the solution manager, a Plexus project opened
outside a solution sees only published bases. Wave 1 delivers the mechanism
and the generator wiring; full "any open sibling" coverage arrives with the
explorer unification. No regression versus current behavior in either case
(today's composer already resolves published-only).

## Section 6 — Testing

Unit (`solution-manager/engine/tests/solution-base-resolver.test.ts`), over a
fake `SolutionManagerService`/members with in-memory `IStorage` and a fake
inner published source:

- A live open producer member resolves as a base (compiled from its live
  sources), preferred over a published package of the same id.
- No matching member → delegates to the inner published source.
- Recursive: a member bound to another open member resolves transitively.
- Cycle guard: two members binding each other don't infinite-loop; resolution
  terminates (the cycle branch yields no further live compile).
- Version mismatch: the live member is still preferred (mismatch is not
  surfaced through the `IPackageSource` seam in this wave).
- Cache: invalidating one member drops only it and its transitive dependents;
  unrelated members' cached compiles survive.
- `StaleMembers` fires carrying exactly the invalidated id set.

Integration (composer): with a `SolutionManagerService` holding an unpublished
producer member and a consumer member bound to it, a `Created`/`Opened` event
runs the consumer's generators and produces generated output referencing the
sibling's concepts. Without a `SolutionManagerService`, the composer falls
back to the published store (existing composer tests stay green).

## Section 7 — Rollout

Wave 1 lands on a branch off the current TODL `worktree-build-modules`
(a096df2), since it builds on the composer/generator code not yet merged.
Plexus consumes it by repacking TODL (the established `refresh-todl.sh`
flow); no Plexus source change is required for Wave 1 beyond the transitive
benefit — the generator wiring is entirely TODL-side. Full TODL suite green
and typecheck no-net-new before completion.
