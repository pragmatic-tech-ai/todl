# TODL App — Plexus Composition Architecture Design

**Date:** 2026-09-06
**Status:** Approved
**Related:** Plexus renderer (`architecture-agent/Plexus/src/renderer/src/app.mu`), mural framework 0.46.8 (`@pragmatic-tech-ai/mural/framework/shell`).

## Problem

`TODL/app`'s renderer is composed by hand. `main.ts` merges a fixed list of
`.mu` dictionaries and constructs one `AppVM extends MuralBase` that holds every
page as a field, an `ActivePage` DP, and a `Show*` `RelayCommand` per page;
`shell.mu` hardcodes the left navigation as a `StackPanel` of buttons; the only
"service" is `RegistryClient`, `new`ed inside `AppVM`. There is no service
provider, no module system, and no capability/navigation model.

Plexus — running the *same* mural 0.46.8 — composes declaratively: an
`Application` root in `app.mu` with `.services:` (DI registrations), `.modules:`
(feature modules), and `resources:` (merged dictionaries + the framework
`EditorShell` root). Each module contributes capabilities, documents, settings,
and services; the framework `NavigationService` flattens module capabilities
into the nav rail, and `DocumentsContentHostService` owns the document Content
region.

## Goal

Recompose `TODL/app`'s renderer on the Plexus architecture: a declarative
`app.mu` root, Mural's service provider, feature modules, the framework
`EditorShell`, `NavigationService`, and `DocumentsContentHostService`. Delete the
hand-rolled `AppVM` and `shell.mu`.

## Framework contracts (mural 0.46.8, verified)

- **Service provider.** `ServiceProvider` implements `IServiceProvider`
  (`get`/`getRequired`/`has`) + `IServiceContainer` (`register`/…). A service is a
  class registered in a `.services:` block, resolved by the provider via
  `app.Services.getRequired(Token)`. The token is the class itself (matches
  Plexus's `ServiceKey = ChatSessionsService`); framework services also expose a
  static `Key: ServiceKey<T>`. A service extends `ServiceBase` (ctor
  `(provider: IServiceProvider)`, exposes `protected Provider`) and reaches peers
  via `this.Provider.getRequired(Peer)`.
- **Module.** `module NAME [ Name="…" ] { .services: {…} Capability [ Name, Icon,
  ServiceKey ] }` compiles to a `ShellModule` with `Capabilities`, `Documents`,
  `Settings`, `Commands`, `ShellControls`, `ProjectFactories`, `Resources`, and
  service registrations (`RegisterServices(container)`).
- **Capability.** `Capability [ Name, Icon, ServiceKey ]` — `NavigationService`
  turns each into a rail destination; the selected capability's `ServiceKey`
  service renders in the **240px side pane** (`EditorShell` `PART_SidePane`:
  `Content = NavigationService.ActiveService`, `Header = SelectedItem.Label`),
  via `DataTemplate[ServiceType]`.
- **NavigationService** (framework default, auto-provided by `EditorShell`):
  `Items` (destinations), `SelectedItem`, `ActiveService`, `HeaderActions` /
  `FooterActions` (`RailAction`s — non-capability rail buttons), `SidePaneVisible`,
  `PopulateFromModules()`.
- **Documents.** `IDocument { Id: string; Title: string; IsDirty: boolean;
  Save(): void | Promise<void> }`. `DocumentsContentHostService` (bind to
  `ContentHostService` key): `Open(doc)`, `ActiveDocument`, `Close(doc)`,
  `ActivateById(id)`. Documents render in the Content region via
  `DataTemplate[DocType]`. The command toolbar (`PART_CommandHost`) is visible
  only when `ActiveDocument` is set.
- **Settings.** `SettingDefinition [ Key, Label, Kind, Choices, Default, … ]`
  (`SettingKind` enum). A `SettingsContribution` supplies the gear-launcher view
  (`CreateView()`), as Plexus's `PlexusSettingsContribution` does.

## Shell mapping (Approach: faithful editor mapping)

The `EditorShell` renders capabilities in the side pane and Content as documents.
todl's full-page content maps onto documents + side-pane masters:

| todl page | Shell role |
|-----------|-----------|
| Playground | **Document** (`PlaygroundDocument`) — the primary editor content. Not a rail capability; opened at boot + via a "New Playground" rail HeaderAction. |
| Gallery | **Capability** — side-pane corpus list → opens a `PlaygroundDocument`. |
| Packages | **Capability** — side-pane package list (master) → opens a `PackageDocument` (detail). |
| Docs | **Capability** — side-pane section list → opens/updates a `DocsDocument`. |
| Setup | **SettingsContribution** — gear footer launcher; `CreateView()` returns the existing Setup view. |
| Publish | **Rail FooterAction** — `RegistryClient.pickDirectory()` → `publishDir`. |

## Architecture

### Composition root — `renderer/app.mu`

Replaces both `shell.mu` and `app-vm.ts`. Compiles to `export const app`.

```
Application [ Theme = Material, Scheme = MaterialDark ] {
    .services: {
        RegistryClient                                   // shared: Packages/Publish/Setup
        DocumentsContentHostService -> ContentHostService // Content region host
    }
    .modules: {
        PlaygroundModule
        GalleryModule
        DocsModule
        PackagesModule
        PublishModule
        SetupModule
    }
    resources: {
        merge PlaygroundResources
        merge GalleryResources
        merge DocsResources
        merge PackagesResources
        merge PublishResources
        merge SetupResources
        EditorShell x:root { }
    }
}
```

`NavigationService` is the framework default (auto-provided by `EditorShell`,
populated from `.modules:` via `PopulateFromModules()`) — no app registration.

### Directory layout

```
renderer/
  app.mu
  main.ts                                    # thin bootstrap
  services/registry/registry-client.ts       # RegistryClient — now a ServiceBase
  modules/
    playground/  playground.module.mu · playground.resources.mu · playground-document.ts · services/…
    gallery/     gallery.module.mu · gallery.resources.mu · services/gallery-service.ts
    docs/        docs.module.mu · docs.resources.mu · services/docs-service.ts · docs-document.ts
    packages/    packages.module.mu · packages.resources.mu · services/packages-service.ts · package-document.ts
    publish/     publish.module.mu · publish.resources.mu · services/publish-service.ts
    setup/       setup.module.mu · setup.resources.mu · services/setup-contribution.ts
```

Existing `editor/` (Monaco + LSP worker) and `components/example-runner/` stay;
`PlaygroundDocument` wraps them. Page VMs migrate into their module as
services/document classes and keep extending `Observable`/`MuralBase` as today.

### Bootstrap — `renderer/main.ts`

Reduces to the Plexus `main.js` shape:

1. `import { app } from "./app.mu"`.
2. Register the TODL Monaco language + start the LSP Web Worker (today's
   `initTodlEditor()`), before any editor mounts.
3. `await document.fonts.ready; app.initialize(new HtmlTarget(document.getElementById("app")!))`.
4. Wake boot services and seed initial content: open the default
   `PlaygroundDocument` via `app.Services.getRequired(ContentHostService).Open(...)`,
   and select a default rail capability if desired.
5. Pin the non-capability rail buttons. `ShellModule` has no rail-action field,
   so — exactly as Plexus pins its scheme-picker/settings gear in `main.js` — the
   bootstrap pushes `RailAction`s onto `NavigationService.HeaderActions`
   ("New Playground" → `ContentHostService.Open(PlaygroundDocument.blank())`) and
   `FooterActions` ("Publish" → `PublishService.PublishCommand`), resolving the
   services from the provider. (The Setup gear is contributed declaratively — see
   SetupModule.)

All of `AppVM`'s state (`ActivePage`, `ShowPlayground/Gallery/Docs/Packages/Publish/Setup`)
is deleted — navigation is `NavigationService`, content is `ContentHostService`.

### Modules & services

- **PlaygroundModule** — `PlaygroundDocument` (`IDocument`; wraps `PlaygroundVM` +
  example-runner + Monaco/graph). The "New Playground" rail **HeaderAction** that
  opens a blank document is pinned in the bootstrap (see step 5), not a module
  field. `DataTemplate[PlaygroundDocument]` in `playground.resources.mu`. Factory
  statics: `PlaygroundDocument.blank()`,
  `PlaygroundDocument.forExample(entry)`, `PlaygroundDocument.forSources(sources)`.
  `IsDirty=false`, `Save()` no-op (never gates close).
- **GalleryModule** — `GalleryService extends ServiceBase` (side-pane corpus list).
  On select: `this.Provider.getRequired(ContentHostService).Open(PlaygroundDocument.forExample(entry))`.
  `Capability [ Name = "Gallery", Icon = @Gallery, ServiceKey = GalleryService ]`.
- **DocsModule** — `DocsService extends ServiceBase` (side-pane section list). On
  select: open/activate a `DocsDocument` for that section (`ActivateById` if already
  open). `Capability [ Name = "Docs", Icon = @Docs, ServiceKey = DocsService ]`.
- **PackagesModule** — `PackagesService extends ServiceBase` (side-pane package list
  = master; `this.Provider.getRequired(RegistryClient)` for `list`/`getMeta`). On
  select: open/activate a `PackageDocument` (detail: version/kind/dist-tags/deps +
  resolved-closure + node/edge counts + "Open sources in playground" →
  `RegistryClient.getSources` then `ContentHostService.Open(PlaygroundDocument.forSources(...))`).
  `Capability [ Name = "Packages", Icon = @Packages, ServiceKey = PackagesService ]`.
  Owns `PackageDocument` + `DataTemplate[PackageDocument]`.
- **PublishModule** — `PublishService extends ServiceBase` exposing a
  `PublishCommand`: `RegistryClient.pickDirectory()` → on a chosen dir,
  `RegistryClient.publishDir(dir)`. Reuses today's `PublishVM` logic. Surfaced as
  a rail **FooterAction** pinned in the bootstrap (step 5); no capability, no new
  dialog dependency.
- **SetupModule** — `SetupContribution` bound to the framework settings seam
  (`SettingsContributionKey`), gear footer launcher. `CreateView()` returns the
  existing Setup view (registry/scope/org fields + stored-token box + env-var
  combobox from `RegistryClient.listEnvVars()`), talking to `RegistryClient`
  exactly as today. The GitHub token stays a main-process secret — it is NOT a
  typed `SettingDefinition`.

### Root services

- **RegistryClient** — moved to `services/registry/`, now `extends ServiceBase`
  (ctor takes the provider; its `bridge()` still reads `window.__todlBridge ??
  window.todl`). Registered in the app `.services:`; peers resolve it by class
  token. Public surface unchanged (`list`, `versions`, `getContent`, `getPackage`,
  `getSources`, `getMeta`, `publishDir`, `resolveClosure`, `getConfig`,
  `setStoredToken`, `useEnvToken`, `listEnvVars`, `setSettings`, `pickDirectory`).
- **DocumentsContentHostService** bound to `ContentHostService` — the Content
  region host, resolved by modules (to `Open` documents) and by the shell.

## Cross-page flows (were `AppVM` methods → now service→service)

- **Open-in-playground** (`AppVM.openInPlayground` / `openPackageSources`): the
  source service resolves `ContentHostService` and opens a `PlaygroundDocument`
  seeded with the example/sources. Activating the document surfaces its Content
  tab; rail selection is unaffected.
- **Master/detail** (Packages): `PackagesService` holds `list` + `Selected`; on
  select it opens/activates a `PackageDocument` by `Id` (`ActivateById` to avoid
  duplicate tabs).

## Deleted / changed

- **Deleted**: `renderer/app-vm.ts`, `renderer/shell.mu`.
- **Moved**: `pages/<x>/` → `modules/<x>/`; `services/registry-client.ts` →
  `services/registry/registry-client.ts` (now `ServiceBase`).
- **Rewritten**: `main.ts` (fixed-dict merge + `AppVM` construction → `import { app }`
  bootstrap).
- **Added**: `app.mu`, six `*.module.mu` + `*.resources.mu`, the document classes.

## Error handling

Unchanged in substance: `RegistryClient` calls propagate bridge/IPC errors to the
calling service, which surfaces them in its side-pane/document view as today.
Read-only documents (`PackageDocument`, `DocsDocument`, viewer `PlaygroundDocument`)
report `IsDirty=false`, so they never gate close/quit.

## Testing

MuralBase-based VMs/services are not node-testable (mural `./runtime` isn't
resolvable under `tsx`) — so, as in the package-manager arc:

- **Unit** (`tsx --test`): plain logic only. `RegistryClient` with an injected
  fake bridge — the existing `services/tests/registry-client.test.ts` carries over
  to the new path.
- **e2e** (Playwright `_electron`): the composition. Rail shows Gallery/Docs/Packages
  capabilities; selecting one populates the side pane; selecting an example opens a
  Playground document; selecting a package opens a `PackageDocument` with the facets
  + open-sources-in-playground; Publish dialog; Setup via the gear. Existing specs
  (`packages-page`, `setup-publish`) retarget to the new shell selectors.
- **Build gate**: `electron-vite build` (main process untouched; renderer recomposed).

## Non-goals

- No change to the main process, the preload bridge, or `RegistryClient`'s wire
  surface — only its location and base class.
- No new registry/package features; behavior parity with today's pages.
- No custom `EditorShell` template override, no document persistence/dirty model
  for the read-only viewers, no title-bar port (the framework default header is
  used; a mural-painted title bar is a later, optional increment).

## Migration order (for the plan)

1. Scaffold `app.mu` + bootstrap `main.ts` + `RegistryClient` service + empty
   `EditorShell` mounting.
2. PlaygroundModule (+ default boot document).
3. GalleryModule (side-pane list → open Playground document).
4. PackagesModule (master list → `PackageDocument` detail + open-sources).
5. DocsModule (section list → `DocsDocument`).
6. PublishModule (footer action + dialog).
7. SetupModule (settings contribution).
8. Delete `AppVM` + `shell.mu`; retarget e2e; `electron-vite build` green.
