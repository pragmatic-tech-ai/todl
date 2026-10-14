# TODL Engine — Architecture Index

> Navigational map for orientation. Read this before re-exploring. **Maintenance rule:** when a change moves or renames a seam below, update this file in the same commit. Line numbers drift — trust the symbol name over the number. (Line anchors captured at v0.52.0.)

**Package:** `@pragmatic-tech-ai/todl` — Layer **L1** engine. Depends on `@pragmatic-tech-ai/todl-runtime` (L0 primitives) + `@pragmatic-tech-ai/mural`. **The engine never imports a higher layer** (server/UX); it only signals upward. ESM, NodeNext.

---

## Layering

- **todl-runtime (L0)** owns the primitives (re-exported from its `index.d.ts`): `Observable`/INPC, `Signal`, `Disposable`, `ServiceProvider`/`ServiceKey`/`ServiceLifetime`/`IServiceContainer`, `ServiceBase`, the storage seam `IStorage`/`IStorageProvider`/`NodeFsStorage`/`FakeStorage`, property bags, the `Ask` prompt family, `IEnvironment`. **The composition-root/module system (`CompositionRoot`, `IModule`/`Module`, `HostKind`) lives in todl-runtime `composition/`, not here.** (todl-runtime is its own sibling repo; the manifest-first lazy composition used by the server is a todl-runtime concern — out of this index's scope.)
- **todl's own composition:** `LspCompositionRoot` (`src/language-server/lsp-composition-root.ts:10`). Headless engine "modules" are authored in **`.mu`** and compiled to `.mu.js` (see Solution services).

## Top-level `src/` module groups

| Dir | Role | Entry |
| --- | --- | --- |
| `compiler-services/` | language/model compiler: parse→resolve→validate→emit | `compiler-services/api.ts` (`check`/`checkAgainst`); façade `Repository` in `model/model.ts` |
| `domain/` | runtime graph engine: loads packages, hosts the heap, reflection root | `domain/index.ts` |
| `graph-api/` | reflection-native query surface over a loaded domain | `graph-api/index.ts` (`GraphQuery`, `IGraphQuery`, `Snapshot`) |
| `cypher/` | Cypher query engine over graph-api | `cypher/index.ts` |
| `manifest/` | SPEC-04 binary manifest (codec/reader/writer/validator + reflection) | `manifest/index.ts`; reflection `manifest/reflection/reflection.ts` |
| `publish/` | compile-to-package + persistence seam | `publish/publish.ts`; `publish/stores.ts` |
| `solution-services/` | solution manager, package manager, project services, build systems, LSP (largest group; many subpath exports) | — |
| `model-data/` | runtime data-source/connector layer | root `index.ts:68-110` |
| `application/` | headless app bootstrap + model-browser VM | `application/application-bootstrapper.ts` |
| `codegen/` | emit typed read-clients / npm packages from a compiled model | `codegen/read-client.ts`, `model-package.ts`, `application-model-data.ts` |
| `reflection-client/` | read-only client over a published snapshot | `reflection-client/index.ts` (`ReflectedRepository`/`ReflectedEntity`) |
| `runtime/` | public surface for consuming a compiled model | `runtime/index.ts` (`TODL`, `Graph`, `Model`/`Instance`) |
| `authoring/` | authoring-time helpers | `authoring/model-draft.ts`, `file-store.ts` |
| `migrate/` | source rewriter/recase tooling | `migrate/rewriter.ts` |
| `language-server/` | out-of-process LSP binary | `language-server/main.ts` (bin `todl-language-server`) |
| `syntax-checker/` | standalone checker binary | `syntax-checker/main.ts` (bin `todl-syntax-checker`) |

## Key subsystems

### Domain / graph — how a graph is built & queried
- **`Domain`** (`src/domain/domain.ts:69`) — three hats: package/manifest loader over an injected `PackageSource`, host of the one heap, cross-manifest reflection root. `async load(ref)` (:106) → `resolvePackage` (:198) composes into a `FrozenGraph`.
- **`FrozenGraph`** (`src/domain/graph.ts:76`, implements `ManifestHost`) — owns the `Heap`, the manifest registry keyed by `model@version`, the reflection surface. Domain composes INTO it.
- **`MemoryPackageSource`** (`src/domain/memory-package-source.ts:6`) — in-memory `PackageSource` for seeding/tests; `CompositePackageSource` chains sources.
- **`GraphQuery` / `IGraphQuery`** (`src/graph-api/graph-query-engine.ts:13` / `graph-api/graph-query.ts:7`) — reflection-native query over a `FrozenGraph`; returns reflection handles; lazy reverse-ref index backs `Referrers`.
- **`TypeInfo`** (`src/manifest/reflection/reflection.ts:293`) — the reflected type handle. ⚠ **Known wart:** `ManifestWriter` folds a concept's namespace into `TypeInfo.name` (so `acme.Service` has `name="acme.Service"`, empty `namespace`). The Cypher adapter works around this with simple-name resolution (`src/cypher/graph.ts`); a proper fix is filed as a Feature.
- **`Repository`** (`src/compiler-services/model/model.ts:75`) — the COMPILE-side runtime façade over `Graph` (resolve/instancesOf/related/closure + `Builder` staging + `ReactiveNode`). Distinct from the domain/graph-api read path. This is the type the server's `ModelView` hands back.

### Cypher (`src/cypher/`)
- **`CypherEngine`** (`engine.ts:16`) — parse+plan+bind+execute over `ICypherGraph`; factory `CypherEngine.OverQuery(IGraphQuery)` (:24); `Execute(source, params?, limits?) → CypherResult`.
- **`GraphQueryAdapter`** (`graph.ts:16`, implements `ICypherGraph`) — adapts graph-api `IGraphQuery` to the Cypher graph contract (incl. simple-name label resolution).
- **`CypherResult`/`CypherResultDto`** (`result.ts:3`); **`Deadline`/`ExecutionLimits`/`ICancellation`** (`execution-limits.ts:8`/`:25`).
- **Barrel `cypher/index.ts`** exports: `CypherEngine`, `CypherResult`(+Dto), `CypherParser`, fluent builder (`CypherQuery`,`Pattern`,`Expr`,`Return`,`Fn`,`Sort`,`Hops`…), value types, `GraphQueryAdapter`+`ICypherGraph`, enums, error family (`CypherError`/`CypherSyntaxError`/`CypherSemanticError`/`CypherTimeout`), `Deadline`+limits. Root re-export `export * as Cypher` (`src/index.ts:472`).

### Package manager (`src/solution-services/package-manager/`)
- **`ProjectManifest`/`parseManifest`/`ProjectType`** (`manifest.ts:28`/`:96`/`:8`) — the project manifest (`ProjectType = MetaModel | Library | Architecture`; **no backend/frontend split**).
- **`StoragePackageSource`** (`storage-package-source.ts:25`) — disk-backed `PackageSource`. **On-disk layout `<model>/<version>/model.json`** (a `PackageDocument`) from any `IStorage`; rebuilds `Repository` via `fromJSON`, emits logical manifest (`ManifestEmitter`), lowers to SPEC-04 (`ManifestWriter`), carries instance graph as seed; recorded deps flow as domain refs.
- **`PackageManifestBridge`** (`package-manifest-bridge.ts:17`) — static bridge from a `CompiledPackage`/`Repository` to Domain-consumable artifacts (`toLogical`/`toResolved`/`seedOf`). **This is the PUBLIC route the server uses to compose a graph** (ManifestEmitter/FrozenGraph are NOT exported — see Public API).

### Publish / build system
- **`publish/publish.ts`**: `PackageKind` (:22 MetaModel/Library/Architecture), `PackageDocument` (:47, own-only `model.json` + deps), `CompiledPackage` (:59), `compilePackage(...)` pure (:90), `async publish(...)` compile+persist (:136).
- **`PackageStore`/`PackageSink`** (`publish/stores.ts:14`/`:20`) — persistence seam (TODL owns no I/O). Impls `BlobPackageStore` (:30, `<base>/model.json` + `<base>/src/<uri>`) + `GraphPackageStore` (:60, into an injected `GraphStore`).
- **`IPackageStore`/`StoragePackageStore`/`PackageStoreKey`** (`solution-services/todl-build-system/package-store.ts:11`) — the BUILD-system store (distinct from the publish seam above; two `PackageStore` concepts).
- **`BuildService`** (`solution-services/todl-build-system/build-service.ts:29`, key `.Key`) — build/publish orchestration (ex-`PackagePublisher`); drives build systems; returns `PublishOutcome`.
- **Build systems:** `npm-package` (`todl-build-system/npm/…`, actions resolve-bases→compile-model→compile-mural→bake-resources→emit-bundle→emit-package-layout→stamp-resource-keys→publish-package) and `html-bundle` (`todl-build-system/html-bundle/…`, browser-safe, emits a self-contained `index.html` for an Architecture project). ⇐ relevant to the future compile bridge: **no build system today emits a server-consumable application manifest, nor splits backend/frontend.**

### Solution services (`src/solution-services/`)
- **`SolutionManagerService`** (`solution-manager/engine/solution-manager-service.ts:41`, extends `ServiceBase`, key :43) — **owns the ONE active solution**; host seams by `ServiceKey` (StorageRegistry, ProjectFactoryRegistry, PromptService, PackageSource, Notification).
- **`SolutionManifest`** (`solution-manager/engine/solution-manifest.ts:12`) — persisted **`.pksln`** (`KIND="todl-solution"`): name + ordered member refs + per-bag settings. Nearest existing "list of packages".
- **`SolutionSession`** (`solution-manager/engine/solution-session.ts:9`) — headless Compose: loads each member deps-first into one `Domain`, collects diagnostics, holds the composed `Domain` (node-free, renderer-safe).
- **`SolutionBaseResolver`** (`solution-manager/engine/solution-base-resolver.ts:42`) — resolves base packages across the solution.
- **`.mu` engines:** `SolutionServicesEngine` (`solution-services-module.mu`), `LspServicesEngine` (`lsp/lsp-module.mu`) — compiled to `.mu.js`.
- **lsp module** (`lsp/`): `host/` (`SolutionLanguageService`, `ILanguageService`), `analysis/` (`AnalysisEngine`, `SemanticTokensProvider`).
- **project-services** (`project-services/`): `core/` (`Project`, `TodlProjectFactory`, `SemVer`), `composition/` (`ProjectSystemComposer`, `TodlProjectSystemModule` — the `./project-system` export), the three factories `architecture-project/`, `meta-model-project/`, `library-project/`.

### Application / application-model-data — what "application" means in TODL *today*
- **`ApplicationBootstrapper`** (`src/application/application-bootstrapper.ts:9`) — `Boot(sources, root?)` composes a `CompositionRoot` from `IContributionSource`s → `ApplicationEntryPoint`. A composed registry of models, **not a running server, not a package-listing deployable.**
- **`ApplicationModelData`** (`src/codegen/application-model-data.ts:20`) — extracts an app root + per-model shards from a compiled document (`Strict` needs an `entrypoint`; `WithSoleModelFallback`). ⇐ **NB:** the vision's first-class "application" (named, versioned, package-listing, deployable to a runtime tenant) does NOT exist yet — these are the closest existing names and will need disambiguation.

## Public API surface (`src/index.ts` + subpath exports)

- **Entry:** `main`=`dist/index.js`, `types`=`dist/index.d.ts`; dev condition → `src/index.ts`. **Subpath exports:** `./solution-services/lsp`, `./language-server`, `./package-manager`(+`/connections`), `./build-system-core`, `./todl-build-system`, `./project-system`, `./domain`, `./graph-api`.
- **Root barrel gives consumers (e.g. pragmatic-server):** runtime re-exports (`Signal`, `Ask`); compile model layer (`Graph`/`EdgeKind`, `InMemoryGraphStore`, `CypherGraphStore`, `Builder`, `Repository`, `EntityBase`); reflection-client; the `model-data` connector layer (:68-110); `application` bootstrap + VMs; `codegen`; publish (`compilePackage`/`publish`/`PackageKind`/`PackageDocument`, `BlobPackageStore`/`GraphPackageStore`/`PackageStore`); package-manager (`StoragePackageSource`, `ProjectType`/`parseManifest`/`ProjectManifest`); predicate/validate/diagnostics/parse; the solution/project-system/build-system surface; policy predicates; `export * as Cypher`.
- **⚠ Notable NON-exports (root barrel):** `ManifestEmitter`, `FrozenGraph`, `Manifest`, `ManifestWriter`, `ManifestReader`. `FrozenGraph` is internal to `domain/` (not even in `domain/index.ts`). `manifest/*` is reachable only by deep import (kept off root to avoid a `MetaKind`/`Cardinality` enum clash). `GraphQuery`/`IGraphQuery` are only via the `./graph-api` subpath, not root. **⇒ To compose a graph from a `Repository`, go through the public `PackageManifestBridge` + `Domain` + `./graph-api` route — do NOT reach for `FrozenGraph`/`ManifestEmitter`.**

## Tests + build

- **Tests:** every test in a `tests/` subfolder next to the code (`CLAUDE.md`); runner `tsx --conditions=development --test "src/**/*.test.ts"`. Extra: `test:corpus`, `test:smoke` (Playwright). Suite ~2180.
- **Build** (`package.json`): `gen:prelude` → `gen:scaffold` → `compile:mu` (`scripts/compile-mu.mjs` lowers `*.mu`→`*.mu.js`) → `tsc -p tsconfig.build.json`. `typecheck` = `tsc --noEmit`. `dist/` mirrors `src/` one-to-one (+`.d.ts`/`.js.map`); subpath/bin targets resolve into it. `dist/` gitignored.
