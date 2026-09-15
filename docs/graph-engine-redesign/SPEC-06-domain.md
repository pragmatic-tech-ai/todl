# SPEC-06 — Domain (ApplicationDomain analog)

> Covers idea **#12**. Naming is BINDING per
> [`JOURNAL.md`](JOURNAL.md): `Domain`, `PackageSource`, `PackageRef`,
> `DomainToken = (manifestId, table, row)`. This spec is the **starting point**
> of the graph-engine tower — the root object every other layer hangs off.

## Goal

Define `Domain`: the runtime container that (1) loads/unloads manifests from
packages, (2) hosts the ONE runtime graph (the heap / the user's live project),
and (3) is the reflection root. It is the TypeScript analog of a .NET
`ApplicationDomain` / `AssemblyLoadContext`. Design is decided; this spec
transcribes it into an implementable shape and wires it to the package
infrastructure that already exists in `src/package-manager`.

## Concept — the AppDomain analog

`Domain` wears **three hats**, exactly as an `AppDomain` does:

1. **Package (assembly) loader.** `load(ref)` resolves a `PackageRef`
   (`model@version`) through an injected `PackageSource`, materializes its
   `Manifest` (SPEC-03/04), transitively loads its dependency manifests, and
   registers everything, deduplicating by `model@version` identity. `tryUnload`
   is the collectible counterpart.
2. **Runtime graph host (ONE heap).** A Domain owns exactly one `Graph`
   (`src/model/graph.ts`) — the active model / session heap, i.e. the user's
   LIVE project. Manifests are the *types*; the graph is the *instances*.
   Packages MAY ship **seed instances** that merge into this one graph; each
   seeded node records the origin `PackageRef` so unload can find and refuse (or
   evict) them. **Multiple models = multiple Domains**, fully isolated, sharing
   nothing but an optional package cache.
3. **Reflection endpoint / root.** `getType`, `resolveToken`, and `reflect`
   are served from the Domain, hopping across loaded manifests. This is the
   `AppDomain.CurrentDomain`-style single point of entry into the reflective
   surface (SPEC-05).

**What carries over from `AppDomain`:**

| .NET AppDomain | TODL Domain |
|----------------|-------------|
| Root object; `AppDomain.CurrentDomain` ambient | `Domain`; optional `Domain.current` ambient |
| One managed heap per domain | One `Graph` per Domain |
| Isolation between domains | Separate Domains share nothing but an optional cache |
| Assembly binding: load + resolve dependency closure | `load()` resolves the transitive manifest closure |
| `AppDomain.AssemblyResolve` fallback event | `onResolveManifest` Signal |
| Collectible `AssemblyLoadContext.Unload()` | `tryUnload()` (refcount + dangling-ref guarded) |
| `AssemblyRef` / cross-assembly `TypeRef` tokens | `Imports` / `TypeRef` tables (SPEC-04); `DomainToken` |

## API

Types live in a new module `src/domain/domain.ts` (with `PackageSource` /
`PackageRef` / `DomainToken` alongside). `Manifest`, `TypeInfo`,
`InstanceMirror` are the SPEC-05 reflection classes; `Graph`, `Node` are from
`src/model/graph.ts`.

### `PackageRef` — package identity (model + version)

```ts
/**
 * A reference to a package by its TODL identity: a model id plus a version.
 * This is the DOMAIN-tier ref (model@version), distinct from the registry-tier
 * `PackageRef` in `src/package-manager/registry/npm-registry.ts`
 * (`{ scope?, name, version? }`). The `PackageSource` implementation bridges the
 * two (see Integration).
 */
export interface PackageRef {
  /** The model id, e.g. "shop-metamodel" — a Manifest's `model`. */
  model: string;
  /** Exact version, e.g. "1.4.0". Omitted = resolve to the source's latest. */
  version?: string;
}
```

Identity for dedup/refcount is the resolved `model@version` string
(`identity(ref) = \`${ref.model}@${ref.version}\``, computed only after a
version has been pinned).

### `PackageSource` — the injected package infrastructure

```ts
/** The manifest bytes + optional seed graph data a source resolves for a ref. */
export interface ResolvedPackage {
  /** The pinned identity the source resolved `ref` to (version filled in). */
  ref: Required<PackageRef>;
  /** SPEC-04 manifest payload: binary bytes OR the JSON debug view. */
  manifest: Uint8Array | ManifestJson;
  /** Declared package dependencies as domain-tier refs, deps-first not required. */
  dependencies: readonly PackageRef[];
  /** OPTIONAL seed instance nodes/edges this package ships (merged into graph). */
  seed?: SeedGraph;
}

/** Flattened seed instances a package contributes to the one heap (SPEC-01/02). */
export interface SeedGraph {
  nodes: readonly Node[];
  edges: readonly Edge[];
}

/**
 * The Domain's package backend — a REAL injected dependency (a registry /
 * PackageStore adapter), NOT a lambda seam-bag. `resolve` turns a domain-tier
 * `PackageRef` into its manifest bytes + deps + optional seed data.
 */
export interface PackageSource {
  /** Resolve a ref to its manifest + deps + seed; rejects if unknown. */
  resolve(ref: PackageRef): Promise<ResolvedPackage>;
  /** OPTIONAL: enumerate concrete versions for a model (dedup / latest pinning). */
  versions?(model: string): Promise<readonly string[]>;
}
```

`ManifestJson` is SPEC-04's JSON debug view type; `Node`/`Edge` are SPEC-01/02.

### `DomainToken` — cross-manifest address

```ts
/**
 * A domain-scoped address into a specific loaded manifest's tables.
 * `manifestId` selects the Manifest within this Domain; `(table, row)` is the
 * SPEC-04 numeric token within it. This is what lets a TypeRef in one manifest
 * name a TypeInfo row in a dependency manifest.
 */
export interface DomainToken {
  /** Identity of the owning Manifest (its `model@version`). */
  manifestId: string;
  /** SPEC-04 table id (u8 code). */
  table: number;
  /** 1-based row index within that table (0 = null/none). */
  row: number;
}
```

### `class Domain`

```ts
export class Domain {
  /** Injected package backend — the real registry/PackageStore adapter. */
  constructor(packages: PackageSource);

  // --- Hat 1: package / manifest loader -----------------------------------

  /** Resolve `ref`, load its manifest + transitive deps, register, and return
   *  the manifest. Reuses an already-loaded manifest by `model@version`
   *  identity (no re-parse). Emits `onManifestLoaded` per NEWLY-loaded manifest
   *  in deps-first order. If the source can't resolve a ref, `onResolveManifest`
   *  is raised as a fallback before failing. */
  load(ref: PackageRef): Promise<Manifest>;

  /** Attempt to unload the manifest identified by `ref` (collectible). REFUSES
   *  (returns false, unloads nothing) if it is still referenced: (a) any live
   *  graph node's `type`/`class` token binds to it, or (b) another loaded
   *  manifest imports it (refcount by identity). On success: unregisters it,
   *  drops its refs, emits `onManifestUnloaded`, returns true. */
  tryUnload(ref: PackageRef): boolean;

  /** Every currently loaded manifest, in load order. */
  readonly manifests: readonly Manifest[];

  /** The loaded manifest for `model` (latest loaded if `version` omitted). */
  getManifest(model: string, version?: string): Manifest | undefined;

  readonly onManifestLoaded: Signal<Manifest>;
  readonly onManifestUnloaded: Signal<Manifest>;

  /** Fallback resolve hook (≈ AppDomain.AssemblyResolve): raised when a ref is
   *  NOT resolvable via the PackageSource. A handler may supply a
   *  ResolvedPackage; the first non-undefined reply is used. */
  readonly onResolveManifest: Signal<ResolveRequest>;

  // --- Hat 2: the one heap -------------------------------------------------

  /** The single runtime graph — the session heap / live project. */
  readonly graph: Graph;

  /** Materialize `data` into the one graph and BIND each node's `type`/`class`
   *  token to a loaded manifest, attributing every seeded node to `boundTo`
   *  (origin PackageRef) for unload tracking. Throws if a token can't bind to a
   *  loaded manifest (load its package first). */
  bindGraph(data: SeedGraph, boundTo: PackageRef): void;

  // --- Hat 3: reflection root ---------------------------------------------

  /** Resolve a qualified name "model:Namespace.Concept" to a TypeInfo across
   *  ALL loaded manifests. The `model:` prefix selects the manifest; the tail
   *  is `TypeInfo.fullName`. Undefined if unknown. */
  getType(qualifiedName: string): TypeInfo | undefined;

  /** Dereference a DomainToken to its reflection handle (TypeInfo / FieldInfo /
   *  TermInfo / … depending on `table`), hopping to the owning manifest. */
  resolveToken(token: DomainToken): MemberInfo | TypeInfo | TermInfo | undefined;

  /** Reflect a live graph node → InstanceMirror (SPEC-05), resolving its
   *  `type`/`class` tokens through the loaded manifests. */
  reflect(node: Node): InstanceMirror;

  // --- Ambient -------------------------------------------------------------

  /** Optional ambient current Domain (≈ AppDomain.CurrentDomain). Set on
   *  construction of the app's primary Domain; multi-Domain hosts may leave it
   *  unset and pass Domains explicitly. */
  static current: Domain | undefined;
}

/** The payload of `onResolveManifest`: the unresolved ref + a slot for a reply. */
export interface ResolveRequest {
  ref: PackageRef;
  /** A handler sets this to satisfy the resolve; first non-undefined wins. */
  resolved?: ResolvedPackage;
}
```

**Semantics notes**

- `load` is idempotent per identity: calling it twice for the same
  `model@version` returns the same `Manifest` instance and does not re-emit
  `onManifestLoaded`.
- Version omitted in a `load(ref)`: the source (or `versions()`) pins the
  latest; the pinned identity is what's registered/deduped.
- A `Manifest` holds a **back-link to its owning `Domain`** so
  `TypeInfo.baseType` (SPEC-05) can hop a cross-manifest `TypeRef` without the
  caller threading the Domain through. This back-link is set at registration.

## Cross-manifest resolution

The chain that makes `TypeInfo.baseType` work across a package boundary
(idea #12's payoff, and the one place SPEC-04's coded indices are finally used):

1. A `TypeInfo.extends` column is a **coded index** `TypeDefOrRef = TypeInfo |
   TypeRef` (SPEC-04). If it points into the local `TypeInfo` table, resolution
   is intra-manifest (SPEC-05 handles it). If it points into the `TypeRef`
   table, the base type lives in a **dependency** manifest.
2. A `TypeRef` row is `{ import: Imports, name: Str }`. The `Imports` table
   (≈ `AssemblyRef`) lists this manifest's dependencies as `model@version`.
   `TypeRef.import` selects the dependency; `TypeRef.name` is the type's
   `fullName` within it.
3. To resolve: the `Manifest` follows its Domain back-link, calls
   `domain.getManifest(import.model, import.version)` to get the dependency
   `Manifest`, then `depManifest.getType(typeRef.name)`. The result is a
   `TypeInfo` owned by the dependency manifest — `baseType` hops the boundary
   transparently.
4. `DomainToken` is the addressing scheme underneath: `(manifestId, table,
   row)`. `resolveToken` on the Domain picks the manifest by `manifestId`, then
   defers to that manifest's SPEC-05 table lookup for `(table, row)`.

**Identity / dedup** is always `model@version`. Two manifests with the same
identity are the same loaded manifest; an `Imports` row and a top-level `load`
that name the same identity converge on one `Manifest` object (this is what
lets a diamond dependency load once).

## Lifecycle

**Load (assembly binding analog):**

1. Pin `ref` to an identity (fill `version` via source/`versions()` if omitted).
2. If already registered by identity → return the existing `Manifest`
   (dedup; no events).
3. Resolve via `PackageSource.resolve(ref)`. On failure, raise
   `onResolveManifest`; if a handler supplies a `ResolvedPackage`, use it, else
   reject.
4. **Recurse deps-first**: `load` each `dependencies[]` ref before finalizing
   this one, so `Imports` back-references always find a loaded target. Cycle
   guard: a manifest mid-load is marked "loading" so a dependency cycle resolves
   to the in-flight instance rather than recursing forever (mirrors
   `resolveClosure`'s stack cycle-check in `resolve.ts`).
5. Construct the `Manifest` (SPEC-05 `load(bytes|json)`), set its Domain
   back-link, register it, bump the **import refcount** of each dependency.
6. If the resolved package carries `seed`, `bindGraph(seed, ref)` merges it into
   the one heap, attributed to `ref`.
7. Emit `onManifestLoaded`; return the manifest.

**Unload (collectible):** `tryUnload(ref)` is a *guarded* eviction:

- **Guard A — graph refcount.** If any live node's `type`/`class` token binds to
  this manifest (including seed nodes attributed to *other* packages that
  reference this manifest's types), refuse. Seed nodes attributed to *this*
  `ref` are its own to evict, but only if nothing else references the manifest's
  types.
- **Guard B — import refcount.** If another loaded manifest's `Imports` names
  this identity (import refcount > 0), refuse — a dependency can't be unloaded
  out from under a dependent.
- On pass: evict this manifest's seed nodes from the graph, decrement the import
  refcount of each of its dependencies (which may now become unloadable),
  unregister, clear the Domain back-link, emit `onManifestUnloaded`, return
  `true`. On any guard fail: mutate nothing, return `false`.

## Integration with existing package infra

The repo already has a full registry/package stack under `src/package-manager`
(all real, tested). The Domain does NOT reinvent it — `PackageSource` is the
seam, and a concrete adapter wraps this stack:

- **`NpmRegistry`** (`src/package-manager/registry/npm-registry.ts`) — wire
  client: packument reads, tarball fetch (`getContent`), publish, SRI verify.
  Registry-tier `PackageRef` is `{ scope?, name, version? }` here.
- **`PackageManager`** (`src/package-manager/package-manager.ts`) — registry
  façade: `getPackage(ref) → InstalledPackage`, `getContents`, `getSources`,
  and crucially **`resolveClosure(rootDeps) → ResolvedClosure`** (a registry-side
  transitive BFS, deps-first). Its `getContent`/`getPackage` give the manifest
  bytes; a Domain-tier `PackageSource` adapter maps `model@version` →
  registry `name@version` and `dependencies` → domain-tier refs.
- **`resolve.ts`** — `InstalledPackage` (`{ name, meta, dependencies,
  document }`), `resolveClosure`, `composeClosure`. `InstalledPackage.meta`
  (`TodlPackageMeta = { kind, id }`) is the **model-identity** source; the
  `document` is today's compiled `TodlDocument` (the future manifest payload).
- **`TarReader`** (`registry/tar-reader.ts`) — unpacks the tarball into an
  `InstalledPackage`.
- **`manifest.ts` / `package-json.ts`** — authored `project.plexus`
  (`ProjectManifest`, `DependencyRef { id, version }`) and the generated npm
  `package.json` with its `todl` block. `DependencyRef` is the natural source of
  a package's declared `dependencies` for `ResolvedPackage`.

**Integration point (do not reinvent):** implement one
`RegistryPackageSource implements PackageSource` in `src/domain/` that holds a
`PackageManager` and, in `resolve()`, calls `getPackage`/`getContent` +
`versions`, translating between the two `PackageRef` shapes. `meta.id` →
`ref.model`; the tarball's version → `ref.version`; `InstalledPackage.dependencies`
+ `DependencyRef` → `dependencies: PackageRef[]`. The SPEC-03/04 manifest bytes
replace today's `document` payload as the emitter lands.

> **NAMING COLLISION (must resolve at implementation time).** The existing code
> already exports both `PackageRef` (registry-tier, in `npm-registry.ts`) and
> `PackageSource` (an *authored source file* `{ name, text }`, in
> `package-manager.ts`). SPEC-06's naming contract mandates a DIFFERENT
> `PackageRef` (model + version) and `PackageSource` (the resolver interface).
> Keep the Domain types in the `src/domain/` module and DO NOT import the
> collided names into scope there; when both must be referenced, alias the
> registry types (e.g. `import { PackageRef as RegistryRef }`). The Domain-tier
> names win in the `src/domain/` surface per the binding contract.

## Relationship to SPEC-03 / 04 / 05

- **SPEC-04 (binary format).** Domain forces the cross-manifest tables:
  `Imports` (≈ AssemblyRef) + `TypeRef`, and the coded-index
  `TypeDefOrRef = TypeInfo | TypeRef` on `extends` / `Field.type` /
  `Target.type`. `DomainToken`'s `(table, row)` are SPEC-04 tokens.
- **SPEC-03 (manifest model).** A `PackageSource.resolve` yields SPEC-03/04
  manifest bytes; `Domain.load` constructs the `Manifest` from them.
- **SPEC-05 (reflection).** `Domain` is the multi-manifest *host* over SPEC-05's
  single-manifest reflection: `getType`/`resolveToken`/`reflect` fan out across
  loaded manifests, and `TypeInfo.baseType` uses the Domain back-link to hop a
  `TypeRef`. `reflect(node) → InstanceMirror` is SPEC-05's mirror, sourced from
  the Domain's graph + manifests.
- **SPEC-01/02 (graph model).** `Domain.graph` is the one heap of flattened,
  self-contained nodes (`type`/`class` tokens, `attrs` user-only). `bindGraph`
  binds those tokens to loaded manifests.

## Testing strategy

TDD, tests under `src/domain/tests/`. Use a fake `PackageSource` returning
in-memory manifests (no network) — same pattern as `HttpTransport` fakes.

1. **Load + register.** `load(a)` returns a `Manifest` whose `model`/`version`
   match; `manifests` contains it; `getManifest("a")` returns it;
   `onManifestLoaded` fired once.
2. **Dedup by identity.** `load(a)` twice → same `Manifest` instance, one event.
   A diamond (`a→b`, `c→b`) loads `b` exactly once.
3. **Deps-first order.** `load(root)` with `root→dep` emits `dep` before `root`.
4. **Cross-manifest `getType` / `baseType`.** A type in `a` extending a type in
   `b` (via `Imports`+`TypeRef`): `getType("a:Ns.Sub").baseType` resolves to the
   `b`-owned `TypeInfo`; `resolveToken` on a cross-manifest token lands in `b`.
5. **`onResolveManifest` fallback.** A ref the source rejects is satisfied by a
   handler-supplied `ResolvedPackage`; with no handler, `load` rejects.
6. **`bindGraph` + seed.** Seed nodes merge into `graph`, attributed to their
   `PackageRef`; their `type`/`class` tokens resolve via `reflect`.
7. **`tryUnload` refuses when referenced.** (a) a live node bound to the
   manifest → `false`, graph + manifests unchanged; (b) another loaded manifest
   imports it → `false`; (c) no refs → `true`, `onManifestUnloaded` fired, node
   count / manifest list updated.
8. **Unload cascade.** After unloading a dependent, its dependency's import
   refcount drops and it becomes unloadable.
9. **Isolation.** Two Domains over the same `PackageSource` keep separate graphs
   and manifest registries; a load in one is invisible to the other.

## Open questions

- **Version-conflict binding policy** (owned here per JOURNAL). When two deps in
  the closure demand different versions of the same `model`, the Domain must
  pick a **unify** (one wins, both bind to it — SemVer-compatible only),
  **pin** (both versions load side-by-side; identity is full `model@version`, so
  they're distinct manifests), or **redirect** (a binding-redirect map, ≈ .NET
  `bindingRedirect`). Default leaning: **pin** (matches AssemblyLoadContext
  side-by-side and the `model@version` identity already chosen), with a
  redirect map as an opt-in override. Decide before `load`'s recursion is
  finalized.
- **Seed-node eviction vs refuse on unload.** When only *this* package's own
  seed nodes reference the manifest, is `tryUnload` allowed to evict them
  (collectible) or must it refuse until the caller clears them? (Guard A wording
  above leans evict-own / refuse-foreign; confirm.)
- **`Domain.current` lifetime.** Whether the ambient is set implicitly by the
  first-constructed Domain or must be assigned explicitly by the host.
- **Cache sharing.** The "optional shared package cache" between Domains — is it
  a shared `PackageSource` instance, or a separate parsed-`Manifest` cache keyed
  by identity? (Parsed-manifest sharing risks the per-manifest Domain back-link;
  likeliest answer: share the `PackageSource`/byte cache, parse per Domain.)

## Implementation tasks (bite-sized, TDD)

1. **Types module.** `src/domain/domain.ts`: `PackageRef`, `DomainToken`,
   `ResolvedPackage`, `SeedGraph`, `PackageSource`, `ResolveRequest`. No logic;
   compile + a trivial identity-string test.
2. **`identity(ref)` + version pinning.** Pure `model@version` helper; test
   omitted-version pinning via a fake `versions()`.
3. **`Domain` skeleton + registry.** ctor(`PackageSource`), `manifests`,
   `getManifest`, the two load/unload Signals. Test empty state.
4. **`load` happy path (single manifest).** Resolve → construct `Manifest`
   (stub SPEC-05 load) → register → back-link → event. Tests 1.
5. **Dedup.** Identity map short-circuits re-load. Tests 2.
6. **Dep recursion + cycle guard.** Deps-first order, in-flight guard. Tests 3.
7. **`onResolveManifest` fallback.** Raise on source failure; accept a reply.
   Tests 5.
8. **`getType` / `resolveToken` fan-out + Domain back-link on Manifest.** Tests
   4 (needs SPEC-05 `Manifest.getType` + SPEC-04 `Imports`/`TypeRef`).
9. **`graph` + `bindGraph` + seed attribution.** Merge nodes/edges, record
   origin `PackageRef`, bind tokens. Tests 6.
10. **`reflect`.** Delegate to SPEC-05 mirror over `graph` + manifests. Tests 6.
11. **`tryUnload` guards A + B + refcounts + cascade.** Tests 7, 8.
12. **`RegistryPackageSource` adapter** over `PackageManager`
    (`src/domain/registry-package-source.ts`). Translate ref shapes + deps; a
    test with a fake `PackageManager`/`NpmRegistry` transport.
13. **`Domain.current` ambient + isolation.** Tests 9.
```
