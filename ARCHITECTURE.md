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
| `engine-bridge/` | TODL on the `@pragmatic-tech-ai/graph` engine: snapshot → schema + seed, policies → access scopes, `.todl` file connector; the ONLY importer of the engine | `engine-bridge/index.ts` (subpath `./engine`) |
| `graph-api/` | reflection-native query surface over a loaded domain | `graph-api/index.ts` (`GraphQuery`, `IGraphQuery`, `Snapshot`) |
| `graph-api/wire/` | the Cypher wire format (cell codec + result DTO types), engine- and cypher-free | `graph-api/wire/index.ts` (root `export * as CypherWire`) |
| `manifest/` | SPEC-04 binary manifest (codec/reader/writer/validator + reflection) | `manifest/index.ts`; reflection `manifest/reflection/reflection.ts` |
| `publish/` | compile-to-package + persistence seam | `publish/publish.ts`; `publish/stores.ts` |
| `solution-services/` | solution manager, package manager, project services, build systems, LSP (largest group; many subpath exports) | — |
| `model-data/` | runtime data-source/connector layer | root `index.ts:68-110` |
| `application/` | headless app bootstrap + model-browser VM | `application/application-bootstrapper.ts` |
| `codegen/` | emit typed read-clients / npm packages from a compiled model | `codegen/read-client.ts`, `model-package.ts`, `application-model-data.ts` |
| `reflection-client/` | read-only client over a published snapshot | `reflection-client/index.ts` (`ReflectedRepository`/`ReflectedEntity`) |
| `runtime/` | public surface for consuming a compiled model | `runtime/index.ts` (`TODL`, `Graph`, `Model`/`Instance`) |
| `authoring/` | authoring-time helpers: `ModelDraft` (staged edits over frozen bases, serialised back to `.todl`) and `TodlFileStore`. Cypher writes reach a draft only through `engine-bridge`'s `TodlFileConnector`; there is no draft-level Cypher writer/baker. TODL's own Cypher engine (`src/cypher`, incl. the writer seam, write operators and overlay) was retired in M2.3 | `authoring/model-draft.ts`, `file-store.ts` |
| `migrate/` | source rewriter/recase tooling | `migrate/rewriter.ts` |
| `language-server/` | out-of-process LSP binary | `language-server/main.ts` (bin `todl-language-server`) |
| `syntax-checker/` | standalone checker binary | `syntax-checker/main.ts` (bin `todl-syntax-checker`) |

## Key subsystems

### Domain / graph — how a graph is built & queried
- **`Domain`** (`src/domain/domain.ts:69`) — three hats: package/manifest loader over an injected `PackageSource`, host of the one heap, cross-manifest reflection root. `async load(ref)` (:106) → `resolvePackage` (:198) composes into its `MetadataSnapshot`, exposed as `Domain.Snapshot`.
- **`MetadataSnapshot`** (`src/domain/metadata-snapshot.ts:76`, implements `ManifestHost`) — owns the `Heap`, the manifest registry keyed by `model@version`, the reflection surface. Domain composes INTO it. Seed attribution: `OriginModelOf` = last binder, `HomeModelOf` = declaring (first) package; `Evict` of a re-binding dependent restores a node to its home package's own seed values instead of removing it.
- **`MemoryPackageSource`** (`src/domain/memory-package-source.ts:6`) — in-memory `PackageSource` for seeding/tests; `CompositePackageSource` chains sources.
- **`GraphQuery` / `IGraphQuery`** (`src/graph-api/graph-query-engine.ts:13` / `graph-api/graph-query.ts:7`) — reflection-native query over a `MetadataSnapshot`; returns reflection handles; lazy reverse-ref index backs `Referrers`.
- **`TypeInfo`** (`src/manifest/reflection/reflection.ts:293`) — the reflected type handle. ⚠ **Known wart:** `ManifestWriter` folds a concept's namespace into `TypeInfo.name` (so `acme.Service` has `name="acme.Service"`, empty `namespace`). The retired TODL Cypher adapter worked around this with simple-name resolution; a proper fix is filed as a Feature.
- **`Repository`** (`src/compiler-services/model/model.ts:75`) — the COMPILE-side runtime façade over `Graph` (resolve/instancesOf/related/closure + `Builder` staging + `ReactiveNode`). Distinct from the domain/graph-api read path. This is the type the server's `ModelView` hands back.

### Cypher wire, and the retired TODL Cypher engine (M2.3)
- **Location:** `src/graph-api/wire/` (root `export * as CypherWire`).
- **Retired in M2.3 (0.57.0):** `src/cypher/**` and the root `export * as Cypher` (`CypherEngine`, `GraphQueryAdapter`, `CypherPushDown`, `ICypherWriter`/`WriteOverlay`, parser/planner/operators); `ConnectorRuntimeGraphQuery`; `ConnectorPrefetch`, `ConnectorMirrorMapper`, `ConjunctiveQueryFilterProvider`; `IDescribeOptions.EmitExternalBindings`. Cypher runs on the graph engine (`Cypher` from `@pragmatic-tech-ai/graph`) over the `./engine` bridge; `src/cypher` is no longer a server path, and offline Plexus did not use it (M2.3 Step 0 guard).
- **`CypherCellCodec`** (`cypher-cell-codec.ts`) — result-cell encoding: a node is `{ "$node": MirrorSnapshot }`; a map whose sole key is `$node`/`$map` is escaped as `{ "$map": … }`, so no user map can pass for a node. Decode with `AsNode`/`AsMap`.
- **`CypherResultDto`/`CypherValueDto`/`NodeCellDto`/`CypherWriteStatsDto`** (`cypher-wire-dto.ts`) — the wire shapes `EngineCellMapper` produces. Root re-export `export * as CypherWire`; the module imports neither the engine nor any `cypher` file (`graph-api/wire/tests/cypher-wire.test.ts`).
- **Kept read path:** `GraphQuery`/`IGraphQuery`, `ModelDataSource`, typed read clients on `IModelDataConnector`, the `IDataSourceAdapter` family + `DataSourceAdapterCatalog`. Generated packages wire every model (connector-backed or not) behind `BundledModelDataConnector` over its embedded shard.

### Engine bridge (`src/engine-bridge/`, subpath `./engine`)
- **`SnapshotDescriber.Describe(snapshot, options)`** — `MetadataSnapshot` → engine `ISchemaDescription` (definitions under reserved `todl.Element`, terms as `todl.Term`, seed Owner = home package model id, bindings with `DefaultConnector`) + `DescribeDiagnosticCode` diagnostics.
- **`SavedModelCompiler.Compile(models, bases, solutionName)`** — a solution's SAVED sources (`ISavedModel { ModelId, Namespace, Sources }`) compiled against base documents into one fresh `MetadataSnapshot` with one package per model id (`ModelShardExtractor` membership; `HomeModelOf` = declaring model), deps-first; instances outside every given model (incl. base-library instances) go to the `solutionName` package. Returns `ISavedSnapshot { Snapshot, Repository, Diagnostics }`; an undeclared or duplicate model id is a `saved-model.*` warning, a model id equal to `solutionName` throws `EngineBridgeError(SolutionModelCollision)`.
- **`TodlFileConnector`** (`todl-file`) — engine connector persisting commits into `.todl` files via `ITodlModelWorkspace`/`ITodlDraftSession`; **`TodlNodePlacement`** mints `${namespace}.${id}` ids for Cypher CREATE. **`EngineCellMapper`** — engine Cypher result cells → TODL wire shape (node cell → `MirrorSnapshot`, as `Snapshot.of`).
- Dev loop (Cypher write → files → recompile → `GraphEngine.Upgrade` is a data no-op; moved instance re-owned): `engine-bridge/tests/DevLoop.test.ts`.

### Package security (`src/compiler-services/security/`)
- **Syntax:** a package declares `role`, `contribute` (privileges onto base roles), `profile` (field profiles) and `secured` fields; `SecurityLowering` lowers them, `SecurityValidator` + `PrivilegeRules`/`FieldSecurityRules`/`SystemFieldRules`/`PackageScope`/`ReifiedOperators` reject bad ones. `SecurityValidator` runs only in `checkAgainst` (build/publish), so security diagnostics are build-only: the LSP `SolutionGraph` does not show them live. Vocabulary: `SecurityAction`, `SecurityDepth`, `BaseRoleName`, `FieldProfileRight`, `SecurityTerms`, `SecurityNames` (root barrel).
- **`PackageSecurityCompiler`** produces `IPackageSecurity` (`PackageSecurity`), carried as `CompiledPackage.Security` and `PackageDocument.security`; `EdgeConcepts` (`IEdgeConcept`) lists edge concepts with their endpoint members. A package's `OwnedConcepts` is the effective owned set as of its own compile; `SecuredFields` name the declaring concept and apply to its subconcepts.
- **`CompileFoundation`/`FoundationKind`** (`stdlib/compile-foundation.ts`, root-exported; `checkAgainst` takes a `FoundationKind` parameter) seed the prelude, and the `todl.system` document (the `Owned` aspect) unless the compile is of `todl.system` itself (`publish.ts` uses `PreludeOnly` there). `PackageManifestBridge.repositoryOf(doc, dependencies)` seeds `todl.system` only when the document or a dependency references a system node (`CompileFoundation.ReferencesSystem`), otherwise the prelude alone. The `dependencies` argument is caller-supplied (`StoragePackageSource` reads the recorded dependency documents); `repositoryOf` does not compute the closure. `CompileFoundation.WithoutUnusedSystem` strips the seeded system nodes from published and codegen output all-or-nothing: every system node goes when no non-system node references one, and all stay when any does. `StoragePackageSource.resolve` emits only the document's own nodes (plus the prelude), not the seeded dependency closure, and serves `todl.system` itself from the embedded `SystemPackage` (`solution-services/package-manager/system-package.ts`), so the engine-free `Domain` route loads a package that uses `Owned`.
- **Engine side (`./engine`):** `EnvironmentSecurity` composes `IEnvironmentSecurity`, whose `OwnedConcepts()` and secured-external check are judged over the composed description (inheritance as unified, not as compiled); `EnvironmentNodePlacement` places owner fields; `SystemFieldGuard` is a scope transform that makes them read-only, which hosts MUST apply to every runtime read-write scope (placement defaults on create are exempt); `OwnershipAssignment` is the sole later writer; `SystemFirstPackageSource` (in `solution-services/package-manager`, re-exported by `./engine` with `SystemPackage`) serves `todl.system` from the embedded package and every other model from its inner source. `DataSourceConnector` forwards the engine's `ConnectorContext` (PR12) without interpreting it: `Fetch` passes `request.Context` to `Query`/`QueryPage`, and `Begin(context)` gives the `DataSourceTransaction` the context that its before-image read, every `Apply` and every compensation carry. The adapter contract sees it only as the structural `IDataSourceContext` (`Key`, `''` = anonymous), so `model-data` stays engine-free; the reconnecting and version-bumping decorators pass it through unchanged, and the federated, prefetch and working-copy paths call without one.

### Package manager (`src/solution-services/package-manager/`)
- **`ProjectManifest`/`parseManifest`/`ProjectType`** (`manifest.ts:28`/`:96`/`:8`) — the project manifest (`ProjectType = MetaModel | Library | Architecture`; **no backend/frontend split**).
- **`StoragePackageSource`** (`storage-package-source.ts:25`) — disk-backed `PackageSource`. **On-disk layout `<model>/<version>/model.json`** (a `PackageDocument`) from any `IStorage`; rebuilds `Repository` via `fromJSON`, emits logical manifest (`ManifestEmitter`), lowers to SPEC-04 (`ManifestWriter`), carries instance graph as seed; recorded deps flow as domain refs.
- **`PackageManifestBridge`** (`package-manifest-bridge.ts:17`) — static bridge from a `CompiledPackage`/`Repository` to Domain-consumable artifacts (`toLogical`/`toResolved`/`seedOf`). **This is the PUBLIC route the server uses to compose a graph** (ManifestEmitter/MetadataSnapshot are NOT exported — see Public API).

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

- **Entry:** `main`=`dist/index.js`, `types`=`dist/index.d.ts`; dev condition → `src/index.ts`. **Subpath exports:** `./solution-services/lsp`, `./language-server`, `./package-manager`(+`/connections`), `./build-system-core`, `./todl-build-system`, `./project-system`, `./domain`, `./graph-api`, `./engine` (`SnapshotDescriber`, `SavedModelCompiler`, `TodlFileConnector`, `TodlNodePlacement`, `EngineCellMapper`, `EngineBridgeError`(+`Code`), `DescribeDiagnosticCode`, `TodlNames`, `EnvironmentSecurity`, `SystemFieldGuard`, `OwnershipAssignment`, `SystemFirstPackageSource` + interface types; pinned by `engine-bridge/tests/DevLoop.test.ts`).
- **Root barrel gives consumers (e.g. pragmatic-server):** runtime re-exports (`Signal`, `Ask`); compile model layer (`Graph`/`EdgeKind`, `InMemoryGraphStore`, `CypherGraphStore`, `Builder`, `Repository`, `EntityBase`); reflection-client; the `model-data` connector layer (:68-110); `application` bootstrap + VMs; `codegen`; publish (`compilePackage`/`publish`/`PackageKind`/`PackageDocument`, `BlobPackageStore`/`GraphPackageStore`/`PackageStore`); package-manager (`StoragePackageSource`, `ProjectType`/`parseManifest`/`ProjectManifest`); predicate/validate/diagnostics/parse; the solution/project-system/build-system surface; `export * as CypherWire` (no `Cypher` namespace since M2.3).
- **⚠ Notable NON-exports (root barrel):** `ManifestEmitter`, `MetadataSnapshot`, `Manifest`, `ManifestWriter`, `ManifestReader`. `MetadataSnapshot` is internal to `domain/` (not even in `domain/index.ts`). `manifest/*` is reachable only by deep import (kept off root to avoid a `MetaKind`/`Cardinality` enum clash). `GraphQuery`/`IGraphQuery` are only via the `./graph-api` subpath, not root. **⇒ Two public routes compose a graph:** (1) from published packages / a `Repository`, the `PackageManifestBridge` + `Domain` + `./graph-api` route; (2) from a solution's saved sources, `./engine` `SavedModelCompiler.Compile`, which returns a `MetadataSnapshot` (the type is reachable through `ISavedSnapshot.Snapshot` and `SnapshotDescriber.Describe`, though the class is not exported). Do NOT construct `MetadataSnapshot`/`ManifestEmitter` directly.

## Tests + build

- **Tests:** every test in a `tests/` subfolder next to the code (`CLAUDE.md`); runner `tsx --conditions=development --test "src/**/*.test.ts"`. Extra: `test:smoke` (Playwright). Suite ~2180.
- **Build** (`package.json`): `gen:prelude` → `gen:scaffold` → `compile:mu` (`scripts/compile-mu.mjs` lowers `*.mu`→`*.mu.js`) → `tsc -p tsconfig.build.json`. `typecheck` = `tsc --noEmit`. `dist/` mirrors `src/` one-to-one (+`.d.ts`/`.js.map`); subpath/bin targets resolve into it. `dist/` gitignored.
