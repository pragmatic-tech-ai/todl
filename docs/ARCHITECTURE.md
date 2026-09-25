# TODL Architecture

**Audience:** engineers new to this codebase. This document is a map — what the
system does, how the pieces fit, and where to look. It describes the code as it
stands today (`@pragmatic-tech-ai/todl` v0.36.x).

For the language reference and the wider suite, see the docs hub:
<https://pragmatic-tech-ai.github.io/dev-kit/projects/todl/>. This file is the
in-repo architectural companion to that hub.

---

## Table of contents

1. [What TODL is](#1-what-todl-is)
2. [The two-minute mental model](#2-the-two-minute-mental-model)
3. [Repository map](#3-repository-map)
4. [Core concepts](#4-core-concepts)
5. [The compiler (compiler-services)](#5-the-compiler-compiler-services)
6. [Manifest and reflection](#6-manifest-and-reflection)
7. [Consuming a model (model-data, reflection-client, codegen, authoring)](#7-consuming-a-model)
8. [Publish and packages](#8-publish-and-packages)
9. [Projects and solutions](#9-projects-and-solutions)
10. [The build system](#10-the-build-system)
11. [The runnable app](#11-the-runnable-app)
12. [Tooling (LSP, CLI, migrate)](#12-tooling)
13. [Package surface and dependencies](#13-package-surface-and-dependencies)
14. [Testing and conventions](#14-testing-and-conventions)
15. [End-to-end walkthroughs](#15-end-to-end-walkthroughs)

---

## 1. What TODL is

TODL is the TypeScript rebuild of the **Typed Object Language** — a typed
substrate for authoring and reasoning over ontologies and taxonomies. In plain
terms: you write `.todl` files that declare a domain's *meta-model* (what a
`component` is, what fields and relationships it has, how things are classified),
then author concrete *models* (instances of those concepts wired together), and
TODL **compiles → validates → emits** them into a reflective typed graph you can
query, publish as a package, generate typed TypeScript clients from, and even
compile into a runnable single-page app.

Three properties are worth internalising up front:

- **One graph, many tiers.** Everything — a concept declaration, a taxonomy
  term, a concrete instance — is a `Node` in one graph; every relationship is a
  typed `Edge`. The compiler, the validator, the emitters, and the reflection API
  all work over that single structure.
- **The compiler is the validator.** "Is this model correct?" is answered by
  compiling it. Diagnostics are machine-legible (a code, a span, a message), so
  the same engine powers the language server, the build system, and agent tools.
- **Provenance-blind by file type.** Downstream stages key off *what a file is*
  (a `.todl`, a `.mu`), never where it came from — hand-authored,
  generated, or generated-then-edited are indistinguishable, exactly like `tsc`
  treating a `.ts` the same however it was produced.

---

## 2. The two-minute mental model

```
                       .todl sources
                            │
                 ┌──────────▼───────────┐
                 │  compiler-services    │   parse → load → validate
                 │  (the front end)      │
                 └──────────┬───────────┘
                            │ Repository  (the reflective typed graph)
          ┌─────────────────┼──────────────────────────────┐
          │                 │                               │
     emit/json         emit/manifest                    emit/todl
   (TodlDocument)   (binary + logical)                 (.todl text)
          │                 │                               
          │          manifest + reflection            
          │           (browser-safe read API)         
          │                 │                          
   ┌──────▼─────────────────▼───────┐        ┌─────────────────────────┐
   │  consume                        │        │  publish                │
   │  model-data / reflection-client │        │  compilePackage →       │
   │  codegen (typed DTO classes)    │        │  CompiledPackage →      │
   │  authoring (ModelDraft)         │        │  package stores/registry│
   └──────┬──────────────────────────┘        └───────────┬────────────┘
          │                                                 │
          │            build systems (solution-services)    │
          │        ┌────────────────────────────────────────▼──────────┐
          │        │  npm-package build  →  publishable package layout   │
          │        │  html-bundle build  →  runnable single-page app     │
          │        └───────────────────────┬─────────────────────────────┘
          │                                 │ index.html (self-contained)
          │                                 ▼
          └───────────────────────►  browser: TodlAppBootstrap mounts a
                                      mural Application over the model DTO
```

Read it top to bottom: text becomes a graph, the graph is serialised a few ways,
and those serialisations are consumed (typed clients), published (packages), or
compiled into an app.

---

## 3. Repository map

Everything ships from `src/`. Sibling folders `cli/`, `examples/`, `shared/`
are the demo/corpus suite and are **not** published (`files: ["dist", "README.md"]`).

| Path | Responsibility |
|------|----------------|
| `src/compiler-services/` | The compiler front end: parse, load, validate, emit, prelude, public `check`/`checkAgainst` API, predicate evaluation. |
| `src/manifest/` | The on-wire metadata format (a MoF-style table+heap binary) and its reader/writer/validator. |
| `src/manifest/reflection/` | A read-only, lazy `System.Reflection`-style API over a loaded manifest. |
| `src/model-data/` | Browser-safe runtime model access: `ModelDataSource`, `ModelRegistry`, pluggable connectors. |
| `src/reflection-client/` | `ReflectedEntity` — the typed read lens generated clients extend. |
| `src/codegen/` | Generates typed TypeScript clients (DTO package + per-concept entity classes) from a compiled model. |
| `src/authoring/` | The write path: `ModelDraft` stages instances over frozen bases and serialises back to `.todl`. |
| `src/publish/` | Pure compile-and-persist spine: `compilePackage`, `CompiledPackage`, package stores. |
| `src/domain/` | The multi-manifest runtime host (`Domain`, `FrozenGraph`) for versioned, cross-package reflection. |
| `src/graph-api/` | Read-only query surface (`GraphQuery`, `Snapshot`) and, under `browser/`, the app bootstrap. |
| `src/solution-services/` | The build systems, package sources/registries, project types, and multi-project solution builder. |
| `src/application/` | Composition/host layer (`ApplicationBootstrapper`, `MuralHost`); the generic model-browser view here is legacy. |
| `src/runtime/` | An internal handle-based consumption surface (`TODL.ComposeGraph`) — not the npm `todl-runtime` package (see §13). |
| `src/language-server/` | The LSP (stdio entry `todl-language-server`). |
| `src/language-service/` | Pure whole-project analysis behind the LSP (completion, hover, references, …). |
| `src/migrate/` | Mechanical rewriter for legacy sources → current surface. |
| `src/index.ts` | The package's root barrel (public API surface). |

---

## 4. Core concepts

These are the terms the rest of the codebase assumes you know.

### The typed graph

Defined in `src/compiler-services/model/graph.ts`.

- **Node** — `{ id, tier, type, metaKind, namespace, localId, isClass, class, fields, attrs }`.
  A node is *either* an ontology declaration (a concept, taxonomy, …) *or* a
  concrete instance. `attrs` is a `Map<string, Scalar>` of user scalar data only.
- **Edge** — `{ kind, via, from, to }`. All structure is edges: `TypeOf`,
  `Extends`, `Contains`, `Relationship` (carries the member name in `via`),
  `InstanceOf`, `Represents`, `Narrower`, `Annotated`, `Frames`, `Targets`, …
- **Tier** — `Meta`, `Ontology` (the type/definition layer), or `Instance` (the
  data layer).
- **MetaKind** — for ontology nodes: `Concept`, `Primitive`, `Taxonomy`, `Term`,
  `Viewpoint`, `Annotation`, `Operator`, `Model`, `Package`, `Field`,
  `Relationship`.
- **Scalar** — `string | number | boolean`. Scalar field values live in `attrs`;
  there is no array-of-scalar storage today (a many-valued primitive field
  currently keeps only its last value — a known limitation).
- **Cardinality** — `One` / `Optional` (`?`) / `Many` (`[]`) / `OneOrMore`
  (`[+]`). The enum is canonically owned by `src/manifest/enums.ts` and
  re-exported by the model so both tiers share one definition.

`Graph` wraps a swappable `GraphStore` (default `InMemoryGraphStore`, which keeps
dual adjacency plus type/metaKind indexes) and emits a `changed` signal on every
mutation. `Repository` (`model/model.ts`) is the read+construct façade over a
graph: `resolve(id)`, `instancesOf(concept)`, `effectiveSchema(concept)`,
`supertypesOf`, `represents`, `termsOf`, `attr`, `ref`/`refs`, `validate()`, and
so on. `EntityBase` (`model/entity.ts`) is a lazy per-node read lens used by the
compiler side.

### Declarations

- **Concept** — a type: named fields (`label : string`) and relationships
  (`relationship in -> location?`). Concepts may `extends` another; parent-less
  concepts virtually extend the prelude root `Element`.
- **Primitive** — a scalar refinement (`identifier`, `slug` — `string` with a
  regex).
- **Taxonomy + Term** — a classification of a concept. `taxonomy technologies :
  represents technology { term … }`. Terms form a `Narrower` hierarchy and can
  fix field values.
- **Annotation** — typed metadata attached to concepts/members/terms/instances
  (`annotate icon { path = "…" }`). Well-known ones (`icon`, `label`,
  `entrypoint`, `materialize`) drive presentation and app wiring.
- **Operator** — an author-defined infix glyph (`a --> b`) that materialises into
  an edge (either a plain relationship or a reified edge node).

### Fields vs relationships — the type-directed rule

Whether `x = foo` becomes a **scalar attr** or a **graph edge** is decided by the
*declared member type*, never the surface syntax:

- member typed by a **primitive** → scalar attr.
- member typed by a **concept or taxonomy** (a reference type) → edge.

This is why a bare `calls = api` becomes a `Relationship` edge when `calls` is
concept-typed. The oracle lives in `parse/loader.ts` (`realizeValue`,
`isReferenceMember`). References may be forward — `api` can be declared later.

### Namespaces, models, viewpoints, bound vocabulary

- **Namespace** — every file is `namespace a.b.c { … }`; it gates visibility.
  Qualified names (`ns.x`) resolve to flat node ids; the prelude is implicitly
  imported everywhere.
- **Model** — an instance container that binds vocabulary:
  `model X : <metaModel> uses <taxonomies> conforms <viewpoint> { … }`.
- **Viewpoint + conforms** — a viewpoint frames a subset of concepts; a model
  block declares which viewpoint its entities belong to. A model **split across
  files must declare `conforms` in every block** (each entity carries its home
  viewpoint).
- **Bound vocabulary** — the validator only lets a model construct instances from
  concepts in its bound namespaces: its own namespace + the meta-model namespace +
  the namespace of each `uses` taxonomy. Construct something outside that set and
  you get `constructor.out-of-scope`. (This is the rule behind the ai-assistant
  migration fix: a split block that used no `tech_architecture` taxonomy failed to
  bind the vocabulary for the whole model.)

### Classes and instanceof (clabjects)

A node with `isClass` is a partial, fixed-value definition — a *clabject* that is
both a class and an instance. Instances declare `instanceof <term-or-class>` to
inherit fixed values. `effectiveFields`/`effectiveSchema` merge class-fixed and
own values (class-wins for the ontology view).

### Bases, closure, and the prelude

- **Base** — a compiled model (`TodlDocument`) a project builds on. Bases seed the
  graph so references resolve to base nodes.
- **The prelude** (`stdlib/prelude.ts`, namespace `todl`) is the implicit base in
  *every* compile: the primitives (`identifier`, `slug`, `resourceKey`), the
  well-known annotations, and the root concept `Element`.
- **Closure** — the transitive set of bases a project depends on. Resolving the
  closure is a job of the build's package sources (§8, §9).

---

## 5. The compiler (compiler-services)

Pipeline: `source text → parse (AST) → load (staged passes) → Repository → validate → emit`.
Public entry is `api.ts`.

### parse/

`parse(source, uri)` turns text into a dumb-data AST (`NamespaceNode` with a flat
declaration list) plus syntax diagnostics. The AST mirrors syntax verbatim — no
reference resolution, no attr-vs-edge decisions. Every node carries two
discriminants: `DeclKind` (Primitive, Concept, Taxonomy, Model, Instance, …) and,
for values, `ValueKind` (String, Name, List, Composite, Boolean, Object, Edge). A
bare identifier is always a `NameValue`; the loader decides its meaning later.
Spans (`diagnostics/span.ts`) hang off most nodes for go-to-definition and
diagnostics.

### load (parse/loader.ts)

`load(sources)` / `loadInto(model, sources, reserved, …)` is the front door that
populates a `Repository`. It stages in dependency order so forward references
work; each pass opens a fresh `Builder` and commits before the next reads it:

1. **Parse & flatten** sources into units; drop prelude redeclarations; flag
   orphan concrete objects declared outside a `model {}`.
2. **Resolve pre-pass** — walk every reference, gated by namespace visibility;
   rewrite qualified/bare names to flat ids; collect `undefinedIds` (their edges
   are dropped at commit). Normalise and kind-check `uses`/`libraries`/`conforms`.
3. **Pass 1 — type shells:** primitives, concepts (+ explicit extends),
   taxonomies + terms, viewpoints, annotations, operators.
4. **Pass 2a — members:** concept fields/relationships, annotation params;
   invariant predicates parsed and queued; operators validated against schemas.
5. **Pass 2b — instances & models:** materialise instances; classify each value
   attr-vs-edge from the declared member type; synthesise inline objects and
   reified operator edges through the same `applyInstance` machinery.
6. **Applications & finalize:** annotation applications, application-root
   resolution (`entrypoint`), invariant registration, span recording.

Output: a populated `Repository`, spanned `Diagnostic[]`, and a `provenance` map
(nodeId → source uri).

### validate/

`validate(model)` walks the committed graph and returns `Diagnostic[]`. The rule
families:

- **Cardinality** — required-missing, too-many, empty-not-allowed (against the
  effective own+inherited schema).
- **Reference/target integrity** — relationship targets, taxonomy-typed values,
  boolean values.
- **Model binding & bound vocabulary** — the meta-model resolves; every
  constructor is in scope (`constructor.out-of-scope` otherwise).
- **conforms** — each entity's concept is framed by its declared viewpoint.
- **Classes** — valid `instanceof`; no leaf overriding a class-fixed scalar.
- **Invariants** — predicate evaluation (`predicate/evaluate.ts`).
- **Annotations** — known params, required params, value types.

### emit/

- `emit/json.ts` — the interchange form. `TodlDocument = { nodes, edges }` (enums
  written by member name for a stable, legible wire form). `toJSON(model)`,
  `toJSONOwn(model, ownIds)` (own nodes only, base references left dangling),
  `fromJSON(doc): Repository`, `graphFromJSON`.
- `emit/todl.ts` — re-emits a compiled model back to `.todl` text.
- `emit/manifest.ts` — emits the logical manifest (ontology tier) plus a flattened
  data graph (instance tier) for the binary format. Flattening here is
  *instance-wins* (deliberately unlike the class-wins `effectiveFields`).

### api.ts — the public entry points

- `check(sources)` → `{ model, diagnostics, provenance }`. Compiles + validates
  against the prelude.
- `checkAgainst(bases, sources)` → same, seeding compiled bases first. Internally:
  `new Repository(mergeBases([preludeDocument(), ...bases]))`, then `loadInto`,
  then append `validate`. `check(sources)` is `checkAgainst([], sources)`.
- `mergeBases(bases)` — deserialises bases into one graph with first-wins dedup, so
  a library carrying its meta-model composes with the prelude without duplicate
  nodes.

---

## 6. Manifest and reflection

Once compiled, a model is serialised into a compact **manifest** and read back
through a **reflection** API that never touches the compiler — this is the
browser-safe, runtime read path.

- `src/manifest/` owns the format (a MoF-style table+heap container, SPEC-04). Key
  types: `ManifestWriter` (pure packer; `fromLogical(LogicalManifest)` →
  `toBinary()`/`toJSON()`), `ManifestReader` (decode). `Cardinality`/`MetaKind`
  are canonically owned here. `ManifestEmitter` (`compiler-services/emit/manifest.ts`)
  bridges a compiler `Repository` into a `LogicalManifest`.
- `src/manifest/reflection/reflection.ts` is a read-only, lazy `System.Reflection`
  analog — every handle is a `(Manifest, row)` pair. `Manifest.load(bytes|json)`,
  then `Manifest.reflect(node): InstanceMirror`. The handle classes: `TypeInfo`
  (the Type analog), `FieldInfo`/`RelationshipInfo` (`MemberInfo`), `TermInfo`,
  `TaxonomyInfo`, `InstanceMirror`, and `FieldView` — which crucially separates
  **AXIS 1** `definitionOrigin` (which type declared the field) from **AXIS 2**
  `valueOrigin` (whether the value came from the instance itself or a fixing
  term). Reflection reads a flattened, self-contained `ReflectedNode`, not the
  compiler's graph `Node`.

The compiler `Repository` and this reflection API are two worlds bridged by the
emitter: `Repository` is the live authoring/compile graph; `Manifest`/`TypeInfo`
are the packed, read-only runtime view. Parity between them is asserted in
`manifest/reflection/tests/repository-parity.test.ts`.

For versioned, cross-package scenarios, `src/domain/` (`Domain`, `FrozenGraph`,
`Heap`) hosts many manifests at once and resolves cross-manifest type references.

---

## 7. Consuming a model

*model-data, reflection-client, codegen, authoring.*

### model-data — browser-safe access

`src/model-data/` is the runtime data layer, with no compiler dependency.
`ModelDataSource` (abstract) is a typed façade over a single package's reflection
graph. It is fed by an `IModelDataConnector` (`BundledModelDataConnector` for an
embedded document, `DocumentModelDataConnector` for one handed in at runtime), or
synchronously via `loadDocument(doc)` / the static `fromJSON(doc)` that generated
clients expose. `ModelRegistry` (a service-keyed lookup) indexes multiple sources
by model id and designates a root. `GenericModelDataSource` is the untyped
concrete source the model browser reads; typed codegen subclasses `ModelDataSource`
directly.

### reflection-client — the entity read lens

`src/reflection-client/ReflectedEntity` is the runtime analog of `EntityBase`: a
typed read lens over one reflected instance. It exposes `protected field(name)`,
`ref(member)`, `refs(member)`; generated per-concept subclasses add typed getters
over those primitives. References resolve through the identity-mapped host
(`EntityHost`, implemented by `ModelDataSource`) so a reference always returns the
same cached sibling object. `MirrorReader`/`TermReader` adapt reflection mirrors
and taxonomy terms into the `EntityReader` shape.

### codegen — typed clients

`src/codegen/read-client.ts` `generateReadClient(repo, options)` emits
deterministic `.ts`: a `class <Name> extends ModelDataSource` (per-concept
collection getters like `get technologies(): readonly Technology[]`, a
`static fromJSON(doc)`, a `createEntity` switch) and one
`class <Concept> extends ReflectedEntity` per concept with typed scalar/reference
getters. `model-package.ts` wraps that into a runnable package that embeds each
model's document shard and an `AppRegistry.Create()` factory. `naming.ts` provides
`pascalCase`/`camelCase`/`pluralize`/`allocateNames` (collision-checking). The
generated collection names (`pluralize(camelCase(conceptId))`) are a load-bearing
contract — the generated `app.mu` binds to exactly those names (§10, §11).

### authoring — the write path

`src/authoring/ModelDraft` is a mutable overlay over frozen bases: `add(descriptor)`
stages typed instances (fail-fast on dangling refs), and `toTodl()` /
`toTodlByFile()` serialise the delta back to source. The `InstanceDescriptor`
record it consumes is exactly what codegen's authoring constructors emit.
`TodlFileStore` is the save/load seam over an injected `FileIO`.

---

## 8. Publish and packages

`src/publish/` is the pure compile-and-persist spine (compute is I/O-free;
persistence is a seam).

- `compilePackage(bases, sources, identity, dependencies?)` runs
  `checkAgainst`, gates on errors, and produces a **`CompiledPackage`** with two
  documents: `document` (own nodes only + recorded `dependencies` → becomes
  `model.json`) and `fullDocument` (the full closure — used for presentation, DTO,
  and app-UI generation). A failing compile yields no package, so you cannot
  persist a broken model by accident.
- `publish(...)` compiles then persists through a `PackageStore`
  (`BlobPackageStore` writes `<id>/<version>/model.json` + `src/` + resources;
  `GraphPackageStore` loads into a `GraphStore`).
- `reflect.ts` `deriveClasses(...)` projects the instance-tier clabjects (palette
  items with resolved icons).

**Package sources** (`src/solution-services/todl-build-system/`) form the
resolution chain a build reads through, all implementing
`IPackageSource.TryGet(ref): SourcedPackage | undefined` keyed by `id@version`:
`CompositePackageSource` (first hit wins), `CachingPackageSource` (read-through,
the only writer), `SolutionCacheSource` (IStorage cache laid out
`<id>/<version>/model.json`), `RegistrySource` (terminal — fetches an npm tarball
and reads it via `TarReader`). `StoragePackageStore` unifies publish-write and
resolve-read.

**Registries** (`package-manager/`): `IPackageRegistry` is the backend contract;
`LocalNpmRegistry` implements it over an `IStorage` directory; `PackageRegistryClient`
is the rich per-connection surface (`publish(dir)`, `resolveClosure`, …). The
authored `project.plexus` manifest is transformed to an npm `package.json` by
`toPackageJson`, which pins every base as an exact scoped dependency and embeds a
`todl` block identifying the package kind and id independent of scope.

---

## 9. Projects and solutions

A **project** is a directory with a `project.plexus` manifest. `ProjectType` is
`MetaModel`, `Library`, or `Architecture` (`package-manager/manifest.ts`). Base
dependencies live on the manifest as `ProjectBaseModelBindings`
(`metaModels` / `libraries` / `architectures`, each `{ id, version }`).

`src/solution-services/project-services/` owns the three project factories
(`TodlProjectFactory` base + meta-model/library/architecture subclasses):
create/open/save, manifest read/write, and the agent scaffold under `.claude/`.
Meta-model and library projects are *base-producing* (they compile their own base
document via `IBaseProducingProjectFactory.compileToDocument`); an architecture
project is a terminal consumer that publishes nothing on its own.

`RecursiveProjectReferencesResolver.Resolve(source, bindings)` walks the bindings
plus each package's recorded dependencies (BFS, deduped) to reassemble the full
base closure, collecting any unpublished binding as a problem rather than throwing.

**Solutions** (`solution/solution-build-manager.ts`) build many projects together:
`SolutionBuildManager` derives a dependency-edge map from the base bindings,
topo-sorts it (rejecting cycles), and runs each project through
`TodlProjectBuildManager`. After each success it captures the freshly built
`model.json` into an in-memory `BuildOutputSource` that is prepended to the source
chain, so a dependent resolves its siblings' just-built packages.

---

## 10. The build system

Two layers: a generic engine and its todl-coupled realisation.

### build-system-core — the generic engine

`src/solution-services/build-system-core/` names zero todl types (hosts bind them
through generics). The contract:

- **`IBuildAction<C>`** — `{ Name, Consumes: ArtifactKey[], Produces: ArtifactKey[], Execute(ctx) }`.
  A unit of work. Convention: writing into `ctx.Project` is a persistent content
  generator; writing into `ctx.Sandbox` is staged output promoted only on success.
- **`ArtifactKey<T>`** — a typed, identity-based key for the hot-value bag
  (`BuildArtifacts`) actions pass between each other (files stay the source of
  truth; the bag is an optimisation).
- **`CoreBuildContext`** — `{ Project, Sandbox: IStorage, Artifacts, Options, Diagnostics }`.
- **`BuildSystemRegistry`** validates **consume-before-produce** at registration:
  walking each flavor's actions in order, any `Consumes` key not already produced
  by an earlier action throws. This catches pipeline-ordering bugs before any build
  runs.
- **`ProjectBuildManager`** runs a flavor's actions sequentially against a
  provisioned sandbox, checkpoints diagnostics around each action, stops on the
  first failure, and promotes sandbox → output only if every action succeeded.

### todl-build-system — the realisation

`src/solution-services/todl-build-system/` binds the core to `TodlBuildContext`
(core context + `Manifest` + `Source`) and ships two build systems, pre-registered
by `TodlBuildSystemRegistry`.

**npm-package** (applies to MetaModel ∨ Library ∨ Architecture) — produces a
publishable package layout. Actions:
`ResolveBasesAction → CompileModelAction → [host generators] → EmitPackageLayoutAction`.
It resolves the base closure, compiles to a `CompiledPackage`, optionally bakes
presentation, and stages `package.json` + `model.json` + `src/` + a browser-safe
handle module + `resources/` into the sandbox.

**html-bundle** (Architecture only) — compiles a project into a runnable
single-page app. This is the per-project *application compiler*. The ordered action
list (`html-bundle-build-system.ts`):

1. **ResolveBasesAction** → `ResolvedBases`.
2. **CompileModelAction** → `CompiledModel` (the full closure is on `.fullDocument`).
3. **GenerateModelDtoAction** → writes `generated/model.ts` into the **project**:
   reflects `fullDocument` and runs `generateReadClient` (the typed DTO package).
4. **GenerateAppUiAction** → writes `generated/app.mu` into the project via
   `AppUiTemplate.Render`: an `Application { resources: { StackPanel x:root { … } } }`
   with one section per concept — a header `TextBlock` plus
   `ListBox [ ItemsSource = $<collection>, DisplayMemberPath = "id" ]`, where
   `<collection>` is `pluralize(camelCase(conceptId))` so it matches the DTO
   getter. A clobber guard skips the file if its first line isn't the generated
   marker (so a hand-authored override is preserved).
5. **GenerateEntryAction** → writes `generated/entry.ts`: imports `app` from the
   compiled `app.mu.js`, builds `<Pkg>.fromJSON(window.__TODL_APP__)`, and calls
   `TodlAppBootstrap.Mount(app, dto)`.
6. **CompileMuralAction** → compiles every `.mu` (including the generated one) to
   `compiled/<basename>.mu.js` in the **sandbox**, via mural's `compile()`. Detects
   basename collisions up front and stops on any compile error.
7. **BundleAppAction** → runs **esbuild** over the staged entry: `format: "iife"`,
   `platform: "browser"`, `target: "es2020"`, `keepNames: true` (mural relies on
   name-keyed lookups), `conditions: ["development"]` (resolves `@pragmatic-tech-ai/*`
   from TypeScript `src`). Produces the bundle string in `AppBundle`. It stages
   into a temp dir inside the repo root so esbuild's `node_modules` walk and the
   `@pragmatic-tech-ai/todl` package self-reference resolve. (Resolving a
   *published* `dist` instead of `src` is a known deferred follow-up — no consumer
   builds against an installed todl yet.)
8. **EmitBundledHostAction** → renders a single self-contained `index.html` into
   the sandbox via `HtmlShell.Render(JSON.stringify(fullDocument), bundle)`.

`HtmlArtifacts` holds the keys those actions pass (`GeneratedDto`, `CompiledUi`,
`AppEntry`, `AppBundle`).

> **History note.** This per-project app compiler replaced an earlier design that
> inlined a single frozen, committed 3.5 MB runtime bundle and injected only model
> *data* into it. View logic now lives in the project's generated (and overridable)
> `app.mu`, and the runtime is compiled fresh each build.

---

## 11. The runnable app

The build output `index.html` is fully self-contained. At runtime:

1. The page holds `<div id="todl-app-root">`, then
   `window.__TODL_APP__ = { …the compiled TodlDocument… }`, then the app bundle
   `<script>`. `HtmlShell` (`.../html-bundle/html-shell.ts`) emits this; note it
   lives in the build system, not in `graph-api/browser/`, but shares the
   `todl-app-root` id contract with the bootstrap.
2. The bundle's generated `entry.ts` rehydrates the data —
   `<Pkg>.fromJSON(window.__TODL_APP__)` builds the DTO (the app's DataContext) —
   and imports the mural `Application` exported by the compiled `app.mu`.
3. It calls `TodlAppBootstrap.Mount(app, dto)` (`src/graph-api/browser/todl-app-bootstrap.ts`).
   Mount guards against no-DOM (so the same entry is inert under Node), finds
   `#todl-app-root`, and calls
   `app.initialize(new HtmlTarget(host), { theme: Material, autoScheme: { light, dark }, dataContext })`.
   The bootstrap carries **no view knowledge** — the view is the project's `app.mu`.
4. mural renders: the Material theme resolves control styles and the per-concept
   `ListBox`es bind to the DTO collections. `DisplayMemberPath = "id"` makes each
   row show the entity's `id`.

> **Legacy path.** `src/application/MuralViewContribution` + `ModelBrowserVM` +
> `MuralHost` mount a *generic* built-in model-browser view for any model. The new
> per-project path (`TodlAppBootstrap` + a compiled `app.mu`) does not go through
> it. `ApplicationBootstrapper`/`ApplicationEntryPoint`/`ModelRegistryContribution`
> remain the shared composition machinery; only the view contribution diverges.

---

## 12. Tooling

- **Language server** (`src/language-server/`) — a browser-safe LSP core
  (`server.ts` `createServer`) wired to a stdio transport (`stdio.ts`, the
  `todl-language-server` bin). It maintains a project registry, debounces
  revalidation, and delegates every request to the language service. Capabilities:
  diagnostics, completion, hover, definition, references, rename, document/workspace
  symbols, folding, formatting, code actions, signature help, semantic tokens.
- **Language service** (`src/language-service/`) — pure, cache-free analysis.
  `analyze(sources, bases)` parses/tokenises, runs `checkAgainst`, and groups
  diagnostics per URI; feature modules (`hover`, `completion`, `navigation`,
  `reference-index`, `semantic-tokens`, …) are pure functions over the resulting
  `Analysis`. The server owns caching and transport.
- **CLI** (`cli/`, `todl-demo`) — a demo/corpus runner: `list | run <id> |
  test [--update] | docs`. It runs the golden corpus in `examples/` (the golden
  *is* the normalised pipeline output). Not a published bin.
- **Migrate** (`src/migrate/`) — `rewrite(legacySource)` mechanically upgrades
  legacy sources (sigil strip `&ref`/`@ref` → `ref`, `list<T>` → `T[]`, old
  cardinality → `?`/`[]`/`[+]`, `enum{}` → `taxonomy{}`); `recase.ts` handles the
  kebab → C-like identifier convention.

---

## 13. Package surface and dependencies

`src/index.ts` is a large root barrel re-exporting across every layer (compiler
model, model-data, application, codegen, authoring, publish, predicate, validate,
parse, migrate, and the solution-services surface). Beyond the root, the package
exposes focused subpath exports: `./language-service`, `./language-server`,
`./package-manager` (+ `/connections`), `./build-system-core`,
`./todl-build-system`, `./domain`, `./graph-api`.

Every subpath's `import` has two conditions: **`development`** → raw `./src/**/*.ts`
and **`default`** → compiled `./dist/**/*.js`. In-repo tooling and tests run with
`tsx --conditions=development`, importing TypeScript source directly; published
consumers get `dist`. The published package ships only `dist` and `README.md`.

**Dependencies:** `@pragmatic-tech-ai/mural` (the UI/visual-engine framework —
`Application`, `HtmlTarget`, Material theme, `Observable`) and
`@pragmatic-tech-ai/todl-runtime` (the DI + reactive substrate —
`CompositionRoot`, `ServiceProvider`, `Signal`, `Disposable`). The root barrel
re-exports `Signal`/`Disposable` and the prompt types from `todl-runtime`, so a
todl consumer gets the runtime primitives without importing that package directly.

> **Two things called "runtime" — do not confuse them.**
> - `@pragmatic-tech-ai/todl-runtime` is the **npm package** providing DI and
>   reactive primitives (`CompositionRoot`, `Signal`, `Observable`).
> - `src/runtime/` is an **internal** handle-based consumption surface
>   (`TODL.ComposeGraph`, and `Model`/`Instance`/`TodlDefinition` handles over a
>   `Repository`). It is not exported as the root `Graph` (the root `Graph` is the
>   compiler's `compiler-services/model/graph.ts`).

---

## 14. Testing and conventions

- **Runner.** `npm test` runs `tsx --conditions=development --test "src/**/*.test.ts"`
  (transpile-only; type-checking is a separate `npm run build`). `tsx` does not
  type-check, so `npx tsc --noEmit` may report pre-existing strict-null issues in
  test files that the test gate does not enforce.
- **Test location.** Every test lives in a `tests/` subfolder next to the code it
  exercises (`src/model/tests/builder.test.ts`, never `src/model/builder.test.ts`).
  The glob finds both; keeping source dirs test-free is the convention.
- **Smoke tests.** `user-smoke-tests/` builds the real `test_architecture` project
  end-to-end and renders the result in headless Chromium (Playwright). These are
  **outside** the `src/**` glob — run them with `npm run test:smoke`. They caught
  the DisplayMemberPath rendering bug that unit tests missed.
- **Goldens.** The demo corpus (`examples/`, driven by the CLI) uses golden
  snapshots; the golden is the normalised emit output.
- **House style** (see `CLAUDE.md` and the workspace-global rules): OOP —
  behaviour on classes, no free functions or module-level state; Allman braces;
  PascalCase interfaces and public methods; enums over string-literal unions;
  reused string literals hoisted to `private static readonly` constants; new view
  models extend `Observable`, not `MuralBase`. Generated files
  (`*.generated.ts`, `*.mu.js`) keep their generator's style.
- **Work tracking.** Specs, plans, and tasks live in the GitHub Project
  *Architecture Agentic Suite* (org `pragmatic-tech-ai`, project 1), not under
  `docs/`.

---

## 15. End-to-end walkthroughs

### A. A `.todl` file becomes a validated graph

`check(sources)` seeds a `Repository` with the prelude, parses each source to an
AST, resolves names (visibility-gated), stages types → members → instances through
a `Builder` (classifying each value attr-vs-edge by declared type), applies
annotations, then runs `validate`. Out comes a populated `Repository` plus spanned
diagnostics — query it via `Entity`, or emit it.

### B. A meta-model or library becomes a published package

`TodlProjectBuildManager.Build({ …, BuildSystemId: "npm-package" })` runs
ResolveBases (reassemble the closure through the package-source chain) → CompileModel
(`compilePackage` → `CompiledPackage`) → EmitPackageLayout (stage `package.json` +
`model.json` + `src/` + resources into the sandbox). On success the sandbox is
promoted to the output; `PackageRegistryClient.publish(dir)` then tars it and hands
it to an `IPackageRegistry`, from where downstream projects resolve it.

### C. An architecture project becomes a runnable single-page app

The `html-bundle` build resolves + compiles the closure, generates
`generated/model.ts` (DTO), `generated/app.mu` (per-concept UI), and
`generated/entry.ts` (wiring), compiles every `.mu` with mural, bundles the entry
with esbuild (keepNames, IIFE), and emits one self-contained `index.html` inlining
the model as `window.__TODL_APP__` and the app as a script.

### D. What happens when someone opens that index.html

The page rehydrates the DTO from `window.__TODL_APP__`, constructs the mural
`Application` from the compiled `app.mu`, and `TodlAppBootstrap.Mount` mounts it
into `#todl-app-root` with the Material theme and the DTO as DataContext. mural
renders the per-concept lists — each row showing its entity `id` via
`DisplayMemberPath` — bound live to the model.

---

*Keep this document current as the architecture evolves. It is written for the
next engineer who has to find their way around.*
