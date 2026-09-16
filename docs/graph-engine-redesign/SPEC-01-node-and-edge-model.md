# SPEC-01 — Node & Edge Model

> Part of the TODL graph-engine redesign (see [JOURNAL.md](JOURNAL.md)).
> Covers ideas **#1** (namespace-root), **#2** (operator edges), **#3** (storage-id),
> **#4** (scalar→attr / ref→edge), **#5** (attrs-user-only + `isClass` + `localId`),
> **#6** (`MetaKind.Term`).
> Names in this spec are taken **verbatim** from the JOURNAL "Shared naming
> contract". Where this spec and later specs touch the same name, the JOURNAL wins.

> **Implementation status (2026-09-16, `todl_20`) — IMPLEMENTED.** The `typeOf`
> split (`type` + `metaKind`), all root fields, `attrs`-user-only + blocklist
> deletion (#1/#5), `MetaKind.Term` with the dual-term node (#6), the
> `storageId` reserved slot (#3), and the enforceable **Contains-target-must-be-Term**
> validation are all done; full suite 835 green, typecheck-clean. Two decisions of
> record:
> - **Record identity moved to `localId`, and the `id` attr was DELETED (not
>   retained).** The loader no longer stages an `id` attr; `assertInstance` /
>   `assertModel` set the root `localId`. The prelude's `Element` declares only
>   `label?`/`description?` — there is **no** `id` schema field — so `id` was only
>   ever identity surfaced into `attrs`. Deleting it (vs. leaving it as a "user
>   attr") is what makes the deleted blocklist correct: with `id` gone from
>   `attrs`, `checkOverride` no longer false-positives a `ClassOverride` on the
>   per-instance identity (leaf.id ≠ class.id by nature).
> - **#4 (`HasField` removal) is DONE.** A concept's / annotation's declared
>   field schema now lives on the owner node (`Node.fields: FieldDecl[]`), not as
>   `HasField` member nodes + edges; `EdgeKind.HasField` is deleted. `schemaOf`
>   reads `node.fields`, so its *output* is unchanged — validation, the loader's
>   reference-resolution, the manifest emitter, codegen, and hover are untouched.
>   (The earlier deferral's blocker was "schemaOf is the sole schema source"; the
>   fix moved the *source* onto the node while keeping the *shape*, so nothing
>   downstream had to change.) `HasRelationship` member nodes stay (they carry a
>   navigable `Targets` edge).
> - **#2 (operator endpoint edges) is DEFERRED with evidence** (see Open
>   questions). Its `from`/`to` are member-name strings, not concept references,
>   so there are no separate endpoints to edge-ify beyond the existing `Targets`
>   edge.

## Goal

Reshape the runtime `Node` and `Edge` so that **`attrs` holds user-defined scalar
data only** and all meta/structural information lives at the node root (or, per the
manifest specs, in the manifest). Concretely:

1. Promote `namespace` from an `attrs` entry to a root `Node` field (#1).
2. Split `attrs` into user-data-only, moving the `class` marker to a root boolean
   `isClass` and the term's short id (`attrs.id`) to a root `localId` field (#5).
3. First-class the `term` language construct via `MetaKind.Term`, carried at the
   node root as `metaKind`, so term-membership is *enforceable* (#6).
4. Reserve a `storageId` root field, semantics **deferred** (#3).
5. Make an operator's endpoint references to concepts **real edges**, not scalar
   `from`/`to` attrs (#2).
6. Drop `HasField` edges for **scalar** fields (scalar → owner `attrs`; non-scalar /
   reference field → a real relation edge), narrowing where `EdgeKind` values apply
   (#4).

Together these delete the `effectiveFields` blocklist (`key !== "class" && key !== "id"`)
and turn attr inheritance into a clean overlay with no system-marker special-casing.

## Motivation & current state

The current `Node` interface mixes structural/meta information into the free-form
`attrs` map:

```ts
// src/model/graph.ts:61-68
export interface Node {
  id: NodeId;
  tier: Tier;
  /** The concept (for an instance) or meta-kind (for a concept) — the type-of spine. */
  typeOf: NodeId;
  /** Scalar field values only. */
  attrs: Map<string, Scalar>;
}
```

The doc-comment already *claims* `attrs` is "scalar field values only", but the
codebase violates that in four places:

- **`namespace`** is stored as an attr. `Builder.stageNode` sets it
  (`src/model/builder.ts:287`, also `:147`, `:169`, `:197`), and readers pull it back
  out — `emit/json.ts:80` (`node.attrs.get("namespace")`), the loader's `sourceNs`
  handling, etc. It is provenance/visibility metadata, not user data (#1).
- **`class`** and the term's short **`id`** are stamped into a term's `attrs` by
  `defineTaxonomy`:

  ```ts
  // src/model/builder.ts:195
  const attrs = new Map<string, Scalar>([["class", true], ["id", term.id]]);
  ```

  producing the shape the redesign explicitly dislikes:
  `{ id: "Components.Surface", attrs: { class: true, id: "Surface", namespace: "shop" } }`.
  Two `id`s (root `id` = hierarchical graph id `Components.Surface`; `attrs.id` = short
  id `Surface`) is confusing, and `class` is a system marker, not a user attr (#5).

- The blocklist this forces:

  ```ts
  // src/model/model.ts:246-258 — effectiveFields
  const result = new Map<string, Scalar>(this.graph.getNode(leaf)?.attrs ?? []);
  const cls = this.classOf(leaf);
  if (cls !== null) {
    const clsAttrs = this.graph.getNode(cls)?.attrs;
    if (clsAttrs !== undefined) {
      for (const [key, value] of clsAttrs) {
        if (key !== "class" && key !== "id") result.set(key, value);   // ← the blocklist
      }
    }
  }
  ```

  The overlay must *filter out* `class`/`id` because they live in `attrs`. This is
  fragile: a user attr literally named `class` or `id` collides; the blocklist must be
  kept in sync everywhere attrs merge; and it conflates "don't inherit the marker" with
  "attr overlay". `isClass` is read the same denormalized way at `model.ts:189`
  (`getNode(id)?.attrs.get("class") === true`).

- **Term-ness is not self-describing.** A taxonomy term node's `typeOf` is repurposed
  to its *concept* (`defineTaxonomy` stages `typeOf: term.concept ?? fallback`,
  `src/model/builder.ts:198`), so the `term` language construct is dropped: `MetaKind`
  (`src/model/kinds.ts:6-17`) enumerates every other construct
  (`Concept`, `Primitive`, `Taxonomy`, `Viewpoint`, `Field`, `Relationship`, `Model`,
  `Annotation`, `Package`, `Operator`) but has **no `Term`**. Term-ness is only
  recoverable from `attrs.class === true` plus an incoming `Contains` edge from a
  `typeOf: taxonomy` node — a derived signal, not enforceable. Nothing stops wiring a
  `Contains` edge to a non-term node (#6).

- **Operator endpoints are stringly-typed.** `defineOperator` stores the endpoint
  references as scalar attrs and only `Targets` the concept:

  ```ts
  // src/model/builder.ts:222-227
  this.stageNode(glyph, Tier.Ontology, MetaKind.Operator);
  if (fromMember !== null) this.stagedAttrs.push({ id: glyph, name: "from", value: fromMember });
  if (toMember !== null)   this.stagedAttrs.push({ id: glyph, name: "to",   value: toMember });
  if (relationship !== null) this.stagedAttrs.push({ id: glyph, name: "relationship", value: relationship });
  this.stagedEdges.push({ kind: EdgeKind.Targets, via: null, from: glyph, to: concept });
  ```

  An operator that *relates concepts* should emit real, graph-navigable edges to those
  concept nodes rather than string names buried in attrs (#2).

- **Every field is a `HasField` edge.** `addField` always mints a member node and a
  `HasField` edge (`src/model/builder.ts:141-151`), even for pure scalars. `schemaOf`
  then walks `HasField` to reconstruct fields (`src/model/model.ts:320`). For a scalar
  the field value on an *instance* is already an attr; a schema `HasField` edge to a
  member node for a scalar carries no navigable reference — only reference-typed fields
  need an edge to the target (#4).

The founding principle (JOURNAL): **`attrs` = user data only; meta/structural info at
the node root or in the manifest, never denormalized into the data graph.**

## Design

### New `Node` shape (root fields)

Every field below is **structural / meta** and lives at the root, never in `attrs`.
Names are the JOURNAL contract, verbatim.

| Field       | Type                | Meaning / was                                                                                           |
|-------------|---------------------|---------------------------------------------------------------------------------------------------------|
| `id`        | `NodeId`            | Logical / hierarchical graph identifier (e.g. `Components.Surface`). **Unchanged.**                     |
| `tier`      | `Tier`              | Reflective tier. **Unchanged.**                                                                          |
| `type`      | `NodeId`            | The concept the node is typed by (instance tier) — the manifest `TypeInfo`/concept id. Replaces the **instance-tier** meaning of `typeOf`. |
| `metaKind`  | `MetaKind \| null`  | For an ontology / language-construct node: which construct it is. `Term` is now first-class (#6). `null`/undefined = not a language-construct node. Replaces the **ontology-tier** meaning of `typeOf`. |
| `namespace` | `string \| null`    | Was `attrs.namespace` (#1).                                                                              |
| `localId`   | `string \| null`    | The node's own short id segment (e.g. `Surface`). Was `attrs.id`. Chosen over `shortId`/`termId`/`name` (JOURNAL). |
| `isClass`   | `boolean`           | Was `attrs.class` (#5).                                                                                  |
| `class`     | `NodeId \| null`    | For an instance that is-a term/class: the term/`Class` id it instantiates (Axis-2 value-origin hook, SPEC-05). Optional; `null` = none. |
| `storageId` | `string \| null`    | Reserved dedicated persistence id (#3). **DEFERRED** — see Open questions. Reserve the field, mint/stability/store-role unspecified in v1. |
| `attrs`     | `Map<string, Scalar>` | **User-defined scalar attributes ONLY.**                                                              |

Notes on the `typeOf` split. Today a single `typeOf` overloads two meanings: on an
instance it is the concept; on an ontology declaration it is the meta-kind sentinel
string. This spec splits them: `type` carries the concept (instance tier), `metaKind`
carries the language construct (ontology tier). A node populates one or the other, not
both — **except the dual term** below.

### The dual nature of a term (#6)

A taxonomy term is **both** a language construct (`term`, like `concept`/`taxonomy`)
**and** a class-of-a-concept. Because those are orthogonal, a term node carries **both**
root fields:

- `type` = the **concept** the term is a class of (was `typeOf: term.concept`).
- `metaKind = MetaKind.Term` = the **language construct** it is.
- `isClass = true` (a term *is* a class — a partial, fixed-value definition).
- `localId` = the term's short id (was `attrs.id`).

So term-ness gets its **own** root field (`metaKind`), separate from `type`/`class`.
This is exactly what makes the validation below enforceable.

### Edge rules

`EdgeKind` in the **data graph** carries reference/relationship edges only. The set is
narrowed per idea #4 and the manifest split (SPEC-02/03 move schema structure out of the
data graph); this spec removes the two edge uses below and keeps the rest as applicable.

1. **Scalar field → owner `attrs`; reference field → a relation edge (#4).**
   - A field whose declared type is a **primitive/scalar** contributes an entry to the
     owner node's `attrs` (instance tier) — **no edge**.
   - A field whose declared type is a **non-scalar / reference** (a concept) contributes
     a real relation edge (`EdgeKind.Relationship`, `via` = the member name) to the
     referenced node.
   - Effect on `EdgeKind`: **`HasField` is no longer emitted for scalar schema fields.**
     The data graph carries an edge only where there is an actual reference to navigate.
     (Schema-of-a-concept structure — which fields a concept declares — moves to the
     manifest per SPEC-02/03; it is not carried by `HasField` edges in the cleaned data
     graph.)

2. **Operator endpoints → real edges (#2).**
   - An operator's endpoint references to the concept(s) it relates become real,
     typed edges to those concept nodes, replacing the scalar `from`/`to` attrs.
   - The operator retains its `Targets` edge to the bound concept; the endpoint edges
     make the `from`/`to` relationship graph-navigable instead of stringly-typed. (The
     endpoint *member names* an operator binds — `op.from`/`op.to` used during edge
     materialization at `loader.ts:1342-1343` — remain part of the operator's schema
     definition; what changes is that the concept references are edges, not attrs.)

3. **`Contains` target must be a term (#6, enforceable).**
   - A taxonomy `Contains`-target is valid **only if** the target node carries
     `metaKind === MetaKind.Term`. This turns term-membership from derived-only
     (incoming-`Contains`-from-a-taxonomy) into an enforceable invariant: nobody can
     smuggle a random node into a taxonomy by wiring a `Contains` edge.

`EdgeKind` retained in the data graph (as applicable): `Relationship`, `Narrower`,
`InstanceOf`, `Targets`, `Represents`, `Annotated`, `Frames`, `Contains`. Removed for
their now-invalid uses: `HasField` for scalar fields (#4). (`Extends` and the
`Element` super-node are handled by SPEC-02, not here; `HasRelationship`/`HasInvariant`
schema structure is a manifest concern per SPEC-02/03.)

## Data structures

### `Node` / `Edge` (updated `src/model/graph.ts`)

```ts
export interface Node {
  id: NodeId;
  tier: Tier;

  /** The concept the node is typed by (instance tier); the manifest TypeInfo/concept
   *  id. Replaces the instance-tier meaning of the old `typeOf`. null on pure
   *  ontology-construct nodes. */
  type: NodeId | null;

  /** The language construct this node is (ontology tier); `Term` is first-class (#6).
   *  Replaces the ontology-tier meaning of the old `typeOf`. null on pure instances. */
  metaKind: MetaKind | null;

  /** Namespace (visibility / provenance). Was `attrs.namespace` (#1). */
  namespace: string | null;

  /** The node's own short id segment (e.g. `Surface`). Was `attrs.id` (#5). */
  localId: string | null;

  /** This node is a class — a partial, fixed-value definition. Was `attrs.class` (#5). */
  isClass: boolean;

  /** For an instance that is-a term/class: the term/Class id it instantiates
   *  (Axis-2 value-origin hook, SPEC-05). null = none. */
  class: NodeId | null;

  /** Reserved dedicated persistence id (#3). DEFERRED — see Open questions. */
  storageId: string | null;

  /** User-defined scalar field values ONLY. */
  attrs: Map<string, Scalar>;
}

export interface Edge {
  kind: EdgeKind;
  /** For Relationship / Derived edges: the member node/name it realises; else null. */
  via: NodeId | null;
  from: NodeId;
  to: NodeId;
}
```

`Edge` is structurally unchanged; only the *rules* about which `EdgeKind` values are
emitted change (scalar `HasField` gone; operator endpoint edges added). A term node is
the one node that legitimately populates **both** `type` (its concept) and `metaKind`
(`Term`).

### `MetaKind` enum delta (`src/model/kinds.ts`)

Add `Term`. The JOURNAL fixes the full member set and (for SPEC-04) binary codes 0..9:

```ts
export enum MetaKind {
  Concept = "concept",
  Primitive = "primitive",
  Taxonomy = "taxonomy",
  Term = "term",            // ← NEW (#6)
  Annotation = "annotation",
  Relationship = "relationship",
  Operator = "operator",
  Viewpoint = "viewpoint",
  Model = "model",
  Package = "package",
}
```

> Naming/consistency note (flagged to caller): the **current** enum also contains
> `Field = "field"`, which the JOURNAL's canonical `MetaKind` list omits (its list is
> `Concept, Primitive, Taxonomy, Term, Annotation, Relationship, Operator, Viewpoint,
> Model, Package`). Fields become manifest `Field` records (SPEC-02/03), so `Field` as a
> *node meta-kind* is expected to retire once scalar `HasField` member nodes are gone
> (#4). This spec adds `Term`; the removal of `Field` is coupled to SPEC-02/03 and is
> called out in Open questions rather than executed here to avoid breaking the current
> `addField` member-node path before the manifest pipeline consumes it.

### `EdgeKind` (`src/model/graph.ts`)

No members are deleted by this spec (deletion of `Extends`/`Element` handling is SPEC-02).
The behavioural change is that **`HasField` is not emitted for scalar fields** and
**operator endpoints are emitted as edges**. The final trimmed `EdgeKind` set for the
cleaned data graph is fixed by SPEC-01/02 jointly; SPEC-01 keeps the enum members and
changes emission.

## Migration / impact on existing code

Files and functions to change. (This spec is sequenced **last** in the JOURNAL
implementation order — the manifest pipeline SPEC-03/04/05/06 lands first and then
consumes the cleaned shape. These are the edits when SPEC-01 executes.)

### `src/model/graph.ts`
- Replace `Node.typeOf` with `type` + `metaKind`; add `namespace`, `localId`, `isClass`,
  `class`, `storageId` root fields.
- `Graph.instancesOf(concept)` currently indexes by `typeOf`; retarget it to `type`
  (instance tier). The `byType` index in the store must key on `type`.
- `GraphChangeArgs` / mutation events unaffected in shape; `setAttr` now only ever
  carries a user attr (structural changes go through dedicated setters or node
  replacement).

### `src/model/model.ts`
- **`effectiveFields` (246-258):** delete the `key !== "class" && key !== "id"`
  blocklist. Attr overlay becomes a clean merge of user attrs (leaf over class); the
  markers are no longer in `attrs`, so nothing to filter.
- **`isClass` (188-190):** read `getNode(id)?.isClass` instead of
  `attrs.get("class") === true`.
- **`schemaOf` (315-344):** stop reconstructing scalar fields from `HasField` member
  nodes (#4). Reference-typed members come from relation edges / the manifest; scalar
  field schema comes from the manifest (SPEC-02/03). Adjust `readString(attrs.get(...))`
  reads that assumed member-node attrs.
- **`termsOf` / `classOf` / `instancesOfClass`:** unchanged in signature, but validity
  now depends on `metaKind === Term` targets (see validation rule).
- Any read that pulled `namespace`/`id`/`class` from `attrs` switches to the root field.

### `src/model/builder.ts`
- **`stageNode` (285-289):** stop writing `namespace` into `attrs`; set the root
  `namespace` field. Populate `type` vs `metaKind` per tier instead of a single
  `typeOf` param (two-argument stamping or a discriminated helper).
- **`assertInstance` (62-66):** `asClass` sets root `isClass`, not an `attrs` entry.
- **`defineTaxonomy` → `stageTerm` (193-208):** stop stamping
  `["class", true], ["id", term.id]` into `attrs`; set root `isClass = true`,
  `localId = term.id`, `type = term.concept ?? fallback`, and
  `metaKind = MetaKind.Term`. Keep the `Contains` / `Narrower` / relationship edges.
- **`defineOperator` (215-228):** replace the `from`/`to` scalar attrs with real
  endpoint edges to the concept node(s) (#2); keep `Targets`. Decide the endpoint
  `EdgeKind` (see Open questions / cross-spec note).
- **`addField` (139-151):** for a **scalar** field type, do not stage a `HasField` edge
  or member node destined for the data graph; the value lands in the owner's `attrs`
  (instance tier) and the field *schema* is manifest-owned. For a **reference** field
  type, stage a relation edge (#4). (Coordinate the exact member-node retirement with
  SPEC-02/03.)
- `MetaKind` import already present; add `Term` usage.

### `src/parse/loader.ts`
- **Namespace:** the loader sets namespace via `Builder.setNamespace`; ensure it flows
  to the root `namespace` field. The `sourceNs` map and any `attrs.get("namespace")`
  read (base-node namespace) switch to the root field.
- **Term construction:** the taxonomy path already routes through
  `Builder.defineTaxonomy`; term nodes gain `metaKind = Term` automatically.
- **Operator (`:537`):** `defineOperator` call site unchanged in arguments, but the
  emitted edges change (see builder). Edge materialization at `mintReifiedEdge`
  (`:1335-1351`) still reads `op.from`/`op.to` **member names** to bind endpoints — that
  logic is unaffected; only the operator *node's* concept references become edges.
- **Element parent fill (`:524-525`):** untouched by SPEC-01 (owned by SPEC-02).

### `src/emit/json.ts`
- **`JsonNode` (43-49):** replace `typeOf` with `type` + `metaKind`; add `namespace`,
  `localId`, `isClass`, `class`, `storageId` as first-class JSON fields; `attrs` becomes
  user-data-only.
- **`nodeName` (66-68):** currently falls back to `attrs.get("id")`; switch to root
  `localId`.
- **`nodeDebug` (70-85):** currently reads `attrs.get("namespace")` and infers
  `kind`/`type` from whether `typeOf` resolves to a node; rework to use root
  `namespace`, `metaKind`, and `type`.
- **`emitNode` / `graphFromJSON` (97-106, 153-174):** serialise and rebuild the new root
  fields; enums (`Tier`, `EdgeKind`, `MetaKind`) written by member name as today.

### Tests
- `src/model/tests/builder.test.ts`, `builder-namespace.test.ts`,
  `taxonomy-queries.test.ts`, `class-queries.test.ts`, `model.test.ts`,
  `read-primitives.test.ts`, `schema.test.ts`, `element.test.ts` — assertions that read
  `attrs.get("namespace"|"class"|"id")` or `node.typeOf` migrate to the root fields.
- `src/emit/tests/json.test.ts`, `taxonomy-json.test.ts`, `operator-roundtrip.test.ts`,
  `json-debug.test.ts`, `model-roundtrip.test.ts` — round-trip shape updates for the new
  JSON node fields and operator endpoint edges.
- New tests: term `metaKind` marker; `Contains`-target-must-be-Term validation; scalar
  field → attr vs reference field → edge; operator endpoint edges; `effectiveFields`
  clean overlay (no blocklist); user attr named `class`/`id` no longer collides.

## Testing strategy

TDD, red→green per change. Test files live in a `tests/` subfolder next to the source
(`src/model/tests/…`, `src/emit/tests/…`) per repo convention. Cover:

1. **Node shape** — a taxonomy term node exposes `metaKind === MetaKind.Term`,
   `isClass === true`, `localId === "Surface"`, `type === "<concept>"`, and its `attrs`
   contains **only** user attrs (no `class`/`id`/`namespace`).
2. **Blocklist gone** — `effectiveFields` overlays class fixed values with no
   marker-filtering; a leaf/class carrying a genuine user attr named `class` or `id`
   round-trips as data (regression against the old collision).
3. **`isClass` root read** — `Repository.isClass` reads the root field.
4. **Namespace root** — construction, read (`emit`, loader `sourceNs`), and JSON
   round-trip use the root `namespace`.
5. **Term-membership enforcement** — a `Contains` edge to a node without
   `metaKind === Term` is rejected/diagnosed; to a term it is accepted.
6. **Scalar vs reference field (#4)** — a scalar field yields an owner `attrs` entry and
   **no** `HasField`/relation edge; a reference field yields a relation edge and no
   scalar attr.
7. **Operator endpoint edges (#2)** — an operator emits real edges to its concept
   endpoint(s); no `from`/`to` scalar attrs remain on the operator node; `Targets`
   preserved.
8. **JSON round-trip** — `toJSON` → `graphFromJSON` is identity across all new root
   fields; debug emit reflects `metaKind`/`namespace`/`localId`.

Run: `tsx --conditions=development --test "src/**/*.test.ts"`.

## Open questions

- **`localId` — settled.** Name chosen (over `shortId`/`termId`/`name`); `name` avoided
  because it collides with the `Element.name` field. No further decision needed here.
- **`storageId` — deferred (#3).** Reserve the root field only. Unspecified in v1:
  minting authority, stability across reloads, and its role in the Cypher/graph store vs
  in-memory. Do **not** block SPEC-01 on it; it exists as a typed slot.
- **`MetaKind.Field` retirement.** SPEC-01 adds `Term` but leaves `Field` in the enum;
  its removal is coupled to SPEC-02/03 (manifest `Field` records replace scalar member
  nodes). Sequenced with the manifest pipeline, not here.
- **Operator endpoint `EdgeKind` (#2).** The exact edge kind for operator→concept
  endpoint edges is not fixed by the JOURNAL contract. `Targets` already links
  operator→bound-concept; the two endpoint references may reuse `Targets` (with `via`
  distinguishing from/to) or take a dedicated kind. Decide when SPEC-01 executes,
  consistent with SPEC-02's final `EdgeKind` set. **Flagged as a cross-spec dependency.**

## Implementation tasks (TDD, bite-sized)

Each task: write a failing test → minimal implementation → verify (`tsx … --test`) →
commit. Ordered so each builds on the last.

1. **`MetaKind.Term`.** Failing test: `MetaKind.Term === "term"` and enum member set
   matches the JOURNAL. Add the member to `src/model/kinds.ts`. Verify. Commit.
2. **`Node` root fields (type/metaKind/namespace/localId/isClass/class/storageId).**
   Failing test constructing a `Node` with the new shape. Update the `Node` interface and
   the store index (`instancesOf`/`byType` → `type`). Verify. Commit.
3. **Builder: root namespace.** Failing test: a node staged under `setNamespace("shop")`
   has root `namespace === "shop"` and no `attrs.namespace`. Update `stageNode`. Verify.
   Commit.
4. **Builder: `isClass` root.** Failing test: `assertInstance(..., asClass=true)` sets
   root `isClass`. Update `assertInstance` + `Repository.isClass`. Verify. Commit.
5. **Builder: term root fields + `metaKind`.** Failing test on `defineTaxonomy`: term
   node has `isClass`, `localId`, `type` (concept), `metaKind === Term`, and clean
   `attrs`. Update `stageTerm`. Verify. Commit.
6. **`effectiveFields` blocklist removal.** Failing test: user attr named `class`/`id`
   survives the overlay; class fixed values still win. Delete the blocklist in
   `model.ts`. Verify. Commit.
7. **`Contains`-target-must-be-Term.** Failing test: `Contains` to a non-term is
   diagnosed; to a term passes. Add the validation (builder pre-check / validate pass).
   Verify. Commit.
8. **Scalar → attr / reference → edge (#4).** Failing test: scalar field → attr, no
   edge; reference field → relation edge. Update `addField` (+ `schemaOf` reads). Verify.
   Commit.
9. **Operator endpoint edges (#2).** Failing test: operator emits concept endpoint edges,
   no `from`/`to` attrs, `Targets` intact. Update `defineOperator`. Verify. Commit.
10. **JSON emit/rebuild.** Failing round-trip test across the new root fields + operator
    edges. Update `emit/json.ts` (`JsonNode`, `nodeName`, `nodeDebug`, `emitNode`,
    `graphFromJSON`). Verify. Commit.
11. **`storageId` reserved slot.** Failing test: a `Node` can carry `storageId` and it
    round-trips through JSON (no semantics asserted). Verify. Commit.
