# TODL Runtime Surface — Design

**Status:** In progress. The composition / assembly / model-population **foundation**
is decided (this document). The **tier-handle and member-introspection detail** is
still being modeled — see [Open / Next](#open--next). Nothing here has been
implemented; this is a design spec produced by brainstorming.

**Date:** 2026-09-03

---

## 1. Motivation

Today a compiled TODL model is one flat reflective graph: meta-model relations
(`HasField`, `HasRelationship`, `Extends`, `Targets`, `InstanceOf`, `Represents`)
and domain relations (`Relationship`) come back mixed through the same
`Repository.related()` / `closure()` calls, and consumers touch `EdgeKind` / `Tier`
/ attrs directly. There is no clean metaobject layer, so reading the model conflates
"what a type declares" with "what an instance holds."

The goal is **a single, encapsulating public API for working with a compiled TODL
model at runtime**, that:

- cleanly separates the **meta** layer (types) from the **domain** layer (instances),
- models TODL's full tier tower rather than collapsing it,
- hides the low-level graph (`Node`/`Edge`/`EdgeKind`/`Tier`/attrs) entirely, and
- is the *one* way a consumer works with model metadata and data.

The reference point is .NET: the CLR also stores everything as metadata, but exposes
a clean `System.Reflection` façade (`Type`, `PropertyInfo`) separate from working with
objects. TODL has the raw material (`MetaKind`, `Tier`, `schemaOf`, `effectiveSchema`)
but no such façade. This is that façade.

---

## 2. Scope

### Two surfaces + shared + a bridge

The whole public API is modeled as **two surfaces** with a **shared** contract and a
**bridge**, designed separately:

- **Development surface** ≈ Roslyn / `Reflection.Emit` — authoring, compiling,
  validating, tooling.
- **Runtime surface** ≈ `System.Reflection` + the object model — navigating and
  evaluating a *compiled* model. **This spec.**
- **Shared** ≈ the metadata/assembly format both speak.
- **Bridge** ≈ "compile output becomes runtime input."

Confirmed partition of TODL's existing surface:

| Bucket | Members |
|---|---|
| **Shared** | `Node`, `Edge`, `Tier`, `EdgeKind`, `Cardinality`, `Direction`, `NodeId`, `Scalar`; `MetaKind`; `ConceptSchema`/`FieldSchema`/`RelationshipSchema`; `TodlDocument` (+ `toJSON`/`fromJSON`) — the "assembly"; `SourceSpan` |
| **Development** | `tokenize`, `parse`, `parsePredicate`, `load`, `check`, `checkAgainst`, `validate`; `Diagnostic`/`Severity`/`DiagnosticCode`; `Builder`, `ModelDraft`, `TodlFileStore`; `emitModelTodl`, `toMetaModule`, `generateReadClient`, `migrate/rewrite`; `compilePackage`, `publish`, `PackageStore`; language-service / language-server |
| **Runtime** | `Repository` (as internal engine), `FrozenRepository`; `Entity`, `Element`/`toElement`, `ReactiveNode`; reflection (read); `evaluate`/`satisfies`; `GraphStore`/`CypherGraphStore`, generated read clients, `fromJSON` |

### Decomposition of the runtime surface

**SP1 read → SP2 write → SP3 consolidate.** Caveat discovered during modeling: model
construction blurs the read/write line (see [§6](#6-models)), so the split is a guide,
not a wall.

### What this document covers vs defers

- **Covered (decided):** the three tiers; composition & the application assembly;
  the logical/physical meaning of a model; the population variants and the
  `ModelSource` seam; the entry-point shape as exercised by the canonical scenario.
- **Deferred / open:** the exact tier-handle navigation and member-introspection
  model; evaluation; reactivity; taxonomy/annotation depth; the write surface (SP2);
  programmatic population (P4), source layering, and mutability.

---

## 3. Core concept: the three tiers

TODL is a three-tier (clabject) system, and the runtime surface models all three
explicitly rather than collapsing to .NET's two:

- **Concept** — the meta-type; defines structure (members). From the **meta-model**
  package. (`MetaKind.Concept`, ontology tier.)
- **Class** — a taxonomy **term**; a concrete classifier that *represents* a concept
  and that instances instantiate. From **library** packages. (Term node, `represents`
  → concept, `isClass`.) **Terms are classes, not instances.**
- **Instance** — a concrete object carrying data, `InstanceOf` a class, living **only
  in a model**.

Mapping to existing machinery: `represents` (taxonomy→concept), term = class,
`InstanceOf` (instance→class), `classOf` / `instancesOfClass`.

.NET reading: Concept ≈ the metaclass/schema, Class ≈ `System.Type`, Instance ≈ the
object — TODL makes the metaclass tier first-class instead of collapsing it.

---

## 4. Composition & the application assembly

Three things the word "assembly" was blurring, now separated:

- **Package** — a compiled unit on disk / in a registry (`tech-architecture`,
  `microsoft`). The .NET *assembly file*: identity (id + version), a manifest of
  pinned dependencies, own-only content (`model.json`), and `PackageKind`
  (meta-model vs library). Exists today as `CompiledPackage` / `PackageDocument`.
- **Application assembly** — the app's *own* package that references the others: a
  manifest (`tech-architecture@x`, `microsoft@y`) + the app's own content + the
  **embedded closure** of its dependencies (self-contained, like a single-file .NET
  publish). **The application is itself an assembly** (own identity + manifest).
- **Graph** — the *runtime* composition: an assembly's package closure resolved and
  merged into one live schema. The loaded `AppDomain`, not the file.

Pipeline: **packages → (manifest) application assembly → load/compose → `Graph` →
populate → `Model`s / instances.**

### Decisions

- **Embedding = Hybrid (option C).** `import meta from tech-architecture` yields a
  **package handle** — a thin module wrapping an **embedded resource** (`model.json`
  + manifest). Gives the ergonomic import *and* TODL-owned content management
  (identity, version, dependencies, definitions). `ComposeGraph` consumes handles.
- **Assembly content = concepts (meta-model) + classes (libraries).** Immutable
  schema. **Libraries ship classes, not instances.**
- **Instances live only in models** (see §6).
- **Composition can be dev-time *or* runtime-derived.** A composition of meta-model
  primitives may be derived from user settings at runtime, so the dev/runtime
  boundary is **porous at the composition seam** by design.

### Entry points (as exercised by the scenario, §8)

```
TODL.ComposeGraph(metaModels[], libraries[]) → Graph      // schema composition
await TODL.Load(graph, ModelSource) → void                // population (async)
```

Maps onto existing `mergeBases` / `checkAgainst` (bases), `PackageKind`,
`FrozenRepository`.

---

## 5. Shared contract note

`TodlDocument` is the "assembly format" — the interchange artifact the dev surface
emits and the runtime surface consumes. The runtime `Graph` is a façade over a
`Repository` (kept as the internal engine), so `EdgeKind` / `Tier` / attrs never
leak to a runtime consumer.

---

## 6. Models

### Logical meaning

A model is a **named, bounded instance-world** — a *populated instantiation* of a
meta-model. Defined by three things:

- **Bound schema** — the concepts (+ classes) it is expressed against.
- **Population** — its instances and the relationships among them.
- **Conformance** — the viewpoint it is a description under.

Invariants that make it a *unit*: every instance belongs to exactly one model
(containment); every instance is `InstanceOf` a class that represents a concept in
the bound schema (typedness); references resolve within the bound schema (closure).
Closest analogy: a **named graph** / a **bounded-context instance** / a deserialized
object graph — a scope with identity, independent of where it physically lives.

### Physical meaning

A container node (`MetaKind.Model`) + `Contains` edges to instance nodes + their
`Relationship` / `InstanceOf` edges. The **backing is pluggable** (see §7).

### Decision: definition is dev-time, population is runtime

- A model's **definition** — name, bound schema, viewpoint — is **authored at dev
  time and ships in the application assembly**. Therefore `graph.Models` (the set and
  shape of models) is **known from the assembly**, before any data loads.
- A model's **population** is a **runtime** concern, supplied through a pluggable
  seam (§7).

So a model is always: `definition (static, embedded) + population (pluggable)`.

---

## 7. Population variants

Instances enter a dev-defined model through one **`ModelSource`** seam with several
implementations. The `Model` handle is identical regardless of backing.

| | Variant | Mechanism | Mutability | Analog |
|---|---|---|---|---|
| **P1** | **Embedded (authored)** | Instances authored inline in the model's `.todl`, compiled into the assembly's `model.json`. Ships with the definition. | read-only seed | compiled-in resource; the Plexus declare-and-populate case |
| **P2** | **Store-backed (loaded)** | Instances live in an external store (DB / HTTP); pulled via a `DataLoader`, eager or lazy. | read | ORM materialization; `GraphDataLoader` / `CypherGraphStore` |
| **P3** | **Document (deserialized)** | Instances from a serialized snapshot (`.todl` / `TodlDocument` / JSON) opened at runtime. **Folds into the P2 seam** (a static-snapshot source). | read | object-graph deserialization; `fromJSON` |
| **P4** | **Programmatic (constructed)** | Instances built at runtime via API (user settings, computation). **Deferred.** | mutable | `Activator.CreateInstance` + building an object graph |

`DataLoader` is thus **one implementation** (the `store` case) of the `ModelSource`
seam, not "the" data path. The seam is **host-agnostic**: browser gets
`HttpDataLoader` / `FileDataLoader` / in-memory; server/Node gets
`GraphDataLoader(connectionString)`. (The raw-SQL loader cannot run in a browser.)

### v1 decisions

- **v1 sources:** P1 (embedded) + P2 (store); P3 folds into P2.
- **v1 population is read-only and single-source** (exactly one source per model).
- **Deferred:** P4 (programmatic), source **layering** (embedded seed + runtime
  additions, which needs identity/merge rules), and **mutability** (editing a
  populated model — pulls authoring into the runtime surface).

### Cross-cutting knobs

- **Timing** — eager (source hands over everything on `Load`) vs **lazy**
  (`model.GetInstances(def)` triggers a scoped fetch). P2 over a large DB wants lazy;
  P1 is inherently eager. *Exact `ModelSource` interface shape is [open](#open--next).*
- **Layering** — deferred (single-source in v1).
- **Mutability** — deferred (read-only in v1; P4 is the mutable exception).

---

## 8. Runtime API surface — as modeled so far

Derived from the canonical scenario ([Appendix A](#appendix-a--canonical-scenario)).
Names follow the scenario's .NET-flavored style (PascalCase, `TODL.` static entry,
`typeof`); the TS-convention (camelCase) tension is noted and **deliberate**.

```
TODL (static entry)
  ComposeGraph(metaModels[], libraries[]) → Graph
  Load(graph, ModelSource) → Promise<void>            // async

Graph (runtime root — schema + data)
  .Models : Iterable<Model>                            // known from the assembly
  .GetDefinition(typeof(GeneratedClass)) → TodlDefinition   // typed
  .GetDefinition(name: string)          → TodlDefinition   // dynamic — BOTH supported

Model (a dev-defined instance container)
  .Name : string
  .GetDefinitions() → TodlDefinition[]                 // concept-types instantiated here
  .GetInstances(def) → Instance[]                      // plural

TodlDefinition (the type handle — the CONCEPT tier)
  .Is(other) → boolean                                 // identity / subtype
  .Members → …                                         // OPEN (§Open)
  .Base / .Derived → …                                 // OPEN

Instance (domain handle; a generated typed class when codegen exists)
  typed accessors (.Name, .HostedIn, …) when generated
  dynamic: .GetValue(name), .GetReferences(member), .GetReferrers(), .Definition
                                                       // .Class vs .Concept — OPEN

ModelSource (population seam)   DataLoader is the store impl
  GraphDataLoader(connectionString)   // server/Node
  HttpDataLoader / FileDataLoader     // browser
```

**Access is typed *and* dynamic.** `typeof(GeneratedClass)` (from `generateReadClient`
/ `toMetaModule` output) is a convenience; the string path exists for dynamic
consumers (agents) with no generated types.

Feasibility mapping: `ComposeGraph` ≈ `mergeBases` / `checkAgainst`; `Graph` ≈ a
façade over `Repository`; `TodlDefinition` ≈ a concept node / `ConceptSchema`;
`GetInstances` ≈ `instancesOf` / `instancesOfClass`; `DataLoader` ≈
`GraphStore`/`CypherGraphStore`; typed layer ≈ `generateReadClient` / `toMetaModule`;
immutability ≈ `FrozenRepository`.

---

## 9. The bridge

`compile` / `publish` (dev) → **package** (shared, the "assembly") → `load` /
`ComposeGraph` (runtime) → `Graph` → `ModelSource` populate → `Model`s. Reflection's
read side lives on runtime, its write side on dev; **models are where the two fuse**
(a model is simultaneously runtime-queryable and, eventually, runtime-authorable),
which is the real reason the bridge is a first-class concern.

---

## 10. Open / Next

Explicitly not yet designed — the next modeling sessions:

1. **Tier handle navigation** (the spine). Does `model.GetInstances(conceptDef)`
   return **polymorphically** across every class that represents the concept? Does an
   `Instance` expose **both** `.Class` (its term) and `.Concept` (via `represents`)?
   How do concept ↔ class ↔ instance handles reference each other?
2. **Member / type introspection.** `TodlDefinition.Members`: distinguishing
   **value** field vs **reference** field vs **relationship**; `.Cardinality`;
   `.Base` / `.Derived`. (This is the clean answer to "is every field a `has`?" — the
   member states value-vs-reference.)
3. **The `ModelSource` interface shape.** Eager vs lazy; how `GetInstances(def)` maps
   to a scoped fetch; the class-vs-concept query key.
4. **Evaluation.** `evaluate` / `satisfies` for invariants at runtime.
5. **Reactivity.** An observable variant of the instance handle (`ReactiveNode`).
6. **Taxonomy & annotation depth** on the runtime surface.
7. **Write surface (SP2)** and the deferred population items (P4, layering,
   mutability).
8. **Async specifics** of `Load` and package acquisition; browser vs server hosts.

---

## Appendix A — Canonical scenario

The pseudo-code the runtime surface is being derived from (user-authored):

```
import meta from tech-architecture;
import ms from Microsoft;

namespace application
{
    graphConnection : string = "Server=localhost;Database=TODL;User Id=sa;Password=...;";
    const graph = TODL.ComposeGraph([meta], [ms]);

    TODL.Load(graph, new GraphDataLoader(graphConnection));

    const locationDefinition = graph.GetDefinition(typeof(tech_architecture.Location));

    const models = [...graph.Models];
    for (const model of models)
    {
        if (model.Name === "Major")
        {
            for (const definition : TodlDefinition of model.GetDefinitions())
            {
                if (definition.Is(locationDefinition))
                {
                    const locations : Location[] = model.GetInstances(definition);
                    for (const location of locations)
                        println(`Location: ${location.Name}`);
                }
            }
        }
    }
}
```

(`GetInstances` corrected to plural from the original `getinstance`; `Load` is async
in practice.)
