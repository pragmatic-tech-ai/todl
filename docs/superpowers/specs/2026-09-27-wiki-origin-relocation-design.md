# Wiki-origin relocation into solution-services — design (Wave 2)

> **Kind:** Design spec · **Repos:** TODL (`@pragmatic-tech-ai/todl`) move + Plexus re-point · **Date:** 2026-09-27

## Goal

Move wiki provenance (`WikiOrigin` + the wiki-file locator) from Plexus into
TODL's `solution-services` as a host-free unit, and re-point Plexus's
consumers at it. This is Wave 2 of "Plexus adopts solution-services
wholesale." Wave 1 (`SolutionBaseResolver` + generator wiring) is done; Wave
3 (ProjectExplorerService → wrapper over SolutionManagerService; language
client re-subscription; folding `WorkspaceBaseResolver` into the TODL/host
split) is a separate later spec.

## Background

Plexus's `apps/plexus/src/renderer/src/services/projects/wiki-origin.ts`
defines where a concept's declaring artifact lives — an open source project's
`IStorage`, or a published package at `<packages>/<id>/<version>/` — so the
wiki opener reads a concept's page from the right storage. It is produced by
Plexus's `WorkspaceBaseResolver` (per resolved base) and consumed by the
architecture-projects services (`arch-navigation-service`, `arch-model`,
`arch-diagram-binding-service`). The logic is host-free in substance but
coupled at the edges to: mural's `IServiceProvider`, plexus-core's
`ProducerKind`, Plexus's `ensurePackagesBackend`, and it is written as
module-level free functions.

Two related pieces are already settled and out of scope: base-binding
(`PublishedBaseModelReference` / `ProjectBaseModelBindings`) already lives in
TODL (`project-services/core/base-binding.ts`); `reference-node.ts` is a
`MuralBase` view-model that stays host-side.

## Non-goals

- No move of `WorkspaceBaseResolver`, the wiki opener/reader, or any UI. Wave
  3 owns the resolver/host consolidation.
- No behavior change to wiki resolution — same storages, same paths.
- No new packages-backend abstraction; the locator receives an `IStorage`.

## Global constraints (house style)

OOP (no free functions / module-level mutable state; behavior on classes,
static where pure), Allman braces, PascalCase interfaces + public methods,
enums over string-literal unions, no inline string literals (hoist to
`private static readonly`), tests in a `tests/` subfolder. TODL depends on
`@pragmatic-tech-ai/mural` but on no host application; the moved unit imports
only `@pragmatic-tech-ai/todl-runtime`. Commit attribution:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Section 1 — The moved unit (TODL)

New file `src/solution-services/project-services/core/wiki-origin.ts`.

```ts
import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'

export enum WikiOriginKind
{
    OpenProject = 'openProject',
    Package = 'package',
}

// Where a concept's declaring artifact lives — the base a relative wiki path
// resolves against. Produced by base resolution (per base, open source vs
// published package) and consumed by the wiki opener.
export type WikiOrigin =
    | { readonly kind: WikiOriginKind.OpenProject; readonly storage: IStorage }
    | { readonly kind: WikiOriginKind.Package; readonly id: string; readonly version: string }

export class WikiLocator
{
    public static OpenProjectOrigin(storage: IStorage): WikiOrigin
    {
        return { kind: WikiOriginKind.OpenProject, storage }
    }

    public static PackageOrigin(id: string, version: string): WikiOrigin
    {
        return { kind: WikiOriginKind.Package, id, version }
    }

    // `<id>/<version>/<relPath>` — a page path inside a published package bundle.
    public static PackageWikiPath(id: string, version: string, relPath: string): string
    {
        return `${id}/${version}/${relPath}`
    }

    // Resolve a wiki `relPath` (relative to its declaring artifact) + origin into
    // the concrete storage + storage-relative path. Open source reads from the
    // project's own storage; a published concept reads from `packagesStorage`
    // (the single packages backend) at `<id>/<version>/<relPath>`. The caller
    // supplies packagesStorage (host-free: no backend lookup here).
    public static LocateFile(
        packagesStorage: IStorage, origin: WikiOrigin, relPath: string,
    ): { storage: IStorage; path: string }
    {
        if (origin.kind === WikiOriginKind.OpenProject)
        {
            return { storage: origin.storage, path: relPath }
        }
        return { storage: packagesStorage, path: WikiLocator.PackageWikiPath(origin.id, origin.version, relPath) }
    }
}
```

The `Package` variant drops the former `backend: ProducerKind` field: a
package's kind never routed storage (the page ships at
`<packages>/<id>/<version>/` regardless), so the field was vestigial.

Export `WikiOriginKind`, `WikiOrigin`, `WikiLocator` from `src/index.ts`
(browser-safe — imports only `todl-runtime`).

## Section 2 — Plexus re-point

- Plexus's `apps/plexus/src/renderer/src/services/projects/wiki-origin.ts`
  becomes a thin re-export of the TODL symbols (mirroring how
  `plexus-core/base-binding.ts` re-exports TODL's base-binding), so existing
  import paths keep working:

  ```ts
  export { WikiOriginKind, WikiLocator, type WikiOrigin } from '@pragmatic-tech-ai/todl'
  ```

- Call sites that produced origins move from the free functions to the static
  methods: `openProjectOrigin(s)` → `WikiLocator.OpenProjectOrigin(s)`,
  `packageOrigin(id, v)` → `WikiLocator.PackageOrigin(id, v)` (dropping the
  `ProducerKind` argument). The producer is `WorkspaceBaseResolver`
  (`tagOrigin`/`packageOrigin` uses) — update it and any other producers.
- Call sites that located files move from `locateWikiFile(provider, origin,
  relPath)` (which internally called `ensurePackagesBackend`) to
  `WikiLocator.LocateFile(ensurePackagesBackend(provider), origin, relPath)` —
  the host resolves its own packages backend and passes it. Consumers:
  `arch-navigation-service`, `arch-model`, `arch-diagram-binding-service`
  (grep `locateWikiFile`/`packageWikiPath`/`WikiOrigin` to find them all).
- Delete the moved free functions/enums/types from the Plexus file (now a
  re-export); keep no duplicate definition.

## Section 3 — Testing

TODL unit (`project-services/core/tests/wiki-origin.test.ts`), in-memory
`IStorage`:

- `LocateFile` open-project origin → `{ storage: <project storage>, path: relPath }`.
- `LocateFile` package origin → `{ storage: <packagesStorage>, path: '<id>/<version>/<relPath>' }`.
- `OpenProjectOrigin` / `PackageOrigin` build the right discriminated shapes;
  `PackageWikiPath` composes `<id>/<version>/<relPath>`.

Plexus (acceptance gate): the existing wiki / arch-navigation / arch-model /
arch-diagram-binding tests stay green after the re-point, now resolving the
locator from TODL. `npm run typecheck` clean; the browser-safe barrel guard
still passes (the new export adds no node edge).

## Section 4 — Rollout

Wave 2 lands on a branch off Wave 1's head (`wave1-solution-base-resolver`),
since it shares the same unmerged TODL line; Plexus consumes via
`refresh-todl.sh`. TODL full suite green + typecheck no-net-new; Plexus
typecheck clean + affected suites green.
