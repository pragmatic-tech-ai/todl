# SPEC-03 — Manifest Model (logical)

> Part of the graph-engine redesign. See [JOURNAL.md](JOURNAL.md) for the
> binding naming contract and the full spec index. Covers ideas **#8** and
> **#9**. This spec defines the **logical** manifest model only. The **binary**
> encoding (tables + heaps, tokens) is [SPEC-04](SPEC-04-manifest-binary-format.md);
> the read/reflection **API** over a loaded manifest is
> [SPEC-05](SPEC-05-reflection-api.md); the **Domain** that loads manifests and
> hosts the one graph is [SPEC-06](SPEC-06-domain.md).

## Goal

Define an **additive sidecar** — the *manifest* — that preserves a node's
**field origins** after the compiled data graph is flattened. The manifest is
NOT a replacement for the compiled graph; it is the meta/ontology-tier artifact
that lets a consumer answer, for any flattened instance node and any field:

- **Axis 1 — where was this field *defined*?** (which concept declared it;
  travels `extends`)
- **Axis 2 — where did this field's *value* come from?** (the instance's class,
  or the instance itself; travels class-of)

The logical model here is the human-readable shape and the source of truth for
what the binary format must encode. It is deliberately small and typed so that
SPEC-04 can mirror it 1:1 as tables + heaps and SPEC-05 can reflect over it.

## Motivation & current state

### What `toJSON` emits today

`toJSON` (`src/emit/json.ts:114-126`) walks every node in the `Repository` and
emits a `TodlDocument` = `{ nodes: JsonNode[]; edges: JsonEdge[] }`
(`src/emit/json.ts:59-62`). Each `JsonNode` is
`{ id, tier, typeOf, attrs, debug? }` (`src/emit/json.ts:43-49`) and each
`JsonEdge` is `{ kind, via, from, to, debug? }` (`src/emit/json.ts:51-57`).
`emitNode` copies the node's `attrs` map verbatim
(`Object.fromEntries(node.attrs)`, `src/emit/json.ts:97-106`) and `emitEdge`
writes the structural `EdgeKind` by name (`src/emit/json.ts:108-112`).

Crucially, **the current document is NOT flattened**. Inheritance still lives as
edges in the emitted graph: `EdgeKind.Extends`, `EdgeKind.Contains`,
`EdgeKind.HasField`, `EdgeKind.HasRelationship`, `EdgeKind.InstanceOf`, etc.
(`src/model/graph.ts:27-42`). A consumer that wants an instance's effective
schema or effective field values must walk those edges at read time — exactly
what `Repository.effectiveSchema` (`src/model/model.ts:346-365`) and
`Repository.effectiveFields` (`src/model/model.ts:246-258`) do.

### Why field origins are lost once we flatten

The redesign (idea #8, #9; see [SPEC-01](SPEC-01-node-and-edge-model.md) /
[SPEC-02](SPEC-02-inheritance-flattening.md)) flattens instance nodes: each
node carries its **own + inherited** fields directly, and the data graph drops
`Extends` / `Element` / `Contains` / `HasField`-for-scalars edges so it can be
sharded per type and rendered without any inheritance walk. But flattening a
value onto a node **erases two facts**:

1. **Which concept declared the field** (Axis 1). Once `effectiveSchema`'s merge
   (`src/model/model.ts:346-365`) collapses `[concept, ...supertypesOf(concept)]`
   into one field map, the "subtype wins" resolution
   (`if (!fields.has(field.name)) fields.set(...)`, `src/model/model.ts:352`)
   has already happened and the *declaring* concept is gone. There is no
   `declaringType` on the emitted field.
2. **Whether a value came from the instance's class or the instance itself**
   (Axis 2). `effectiveFields` (`src/model/model.ts:246-258`) overlays the
   class's fixed attrs onto the leaf's own attrs — "class wins" — and the result
   is a single flat `Map`. After the overlay you cannot tell whether
   `attrs.color === "red"` because the class *fixed* it or because the instance
   *set* it. The method even has to hand-maintain a blocklist
   (`if (key !== "class" && key !== "id")`, `src/model/model.ts:253`) to avoid
   inheriting the structural markers that live in `attrs` today — a fragility
   idea #5 calls out and SPEC-01 removes by moving markers to node-root fields.

The manifest restores both facts **without re-introducing edges into the data
graph** (which would recreate the `Element` super-node — idea #7). The concept
hierarchy and the class/term definitions move into a tiny, replicated,
read-mostly manifest; the large instance tier stays flat and sharded.

## Design

### Two artifacts, different lifecycles

| Artifact | Tier | Size | Mutability | Distribution | Contents |
|----------|------|------|------------|--------------|----------|
| **manifest** | meta / ontology | tiny (dozens–hundreds of concepts) | ~immutable per version | replicated / cached everywhere | concept schemas (declared-only), the `extends` hierarchy, class/term definitions, taxonomy definitions, invariants |
| **data graph** | instance | large | high-churn | sharded per type | flattened self-contained nodes (`id, type, class?, namespace, attrs`) + relationship-only edges (`from, rel, to`), plus a `manifestRef` pinning the manifest version |

"Just render" consumers read the sharded data graph and ignore the manifest
entirely. Validation / reflection / subtype-queries / round-trip read the
manifest. The manifest's concept hierarchy has `Element`-with-many-children but,
being replicated and read-mostly, that is free — the super-node disease (idea #7)
only bites a *sharded write-hotspot* with a row per **instance**, which the
manifest never has.

### Declared-only schema storage

The manifest stores, per concept, **only that concept's own declared members and
its single `extends` parent** — NOT the effective (resolved) schema. Effective
schema is resolved on demand by walking the tiny `extends` chain (see Resolution
below). This is a deliberate departure from idea #8's earlier "store resolved
schemas" phrasing: idea #9 locks it to **declared-only**, because declared-only
is what makes Axis-1 origin recoverable (each field knows its one declaring
concept) and keeps the manifest minimal. `Element extends null`; `Element` is a
language **rule/root**, not a stored edge (idea #7).

### Two provenance axes

- **Axis 1 — type/field-definition origin** travels `extends` and is answered by
  the `concepts` map. Each concept lists its *declared-own* fields, relationships
  and invariants plus its single `extends` parent. `typeOriginOf` walks the chain
  and returns the nearest declarer (override → subtype wins).
- **Axis 2 — value origin** travels class-of and is answered by the `classes`
  map. Each class/term lists its `concept`, taxonomy membership, `broader` /
  `narrower` hierarchy, and the `fixed` field values it pins. `valueOriginOf`
  compares a flattened instance value against its class's fixed value: match →
  the class is the origin; otherwise the value is the instance's own.

Instance nodes therefore carry a `class` ref (Axis-2 hook) alongside `type`
(Axis-1 hook) — both structural node-root fields per the JOURNAL naming
contract, **not** edges.

### Definitions in manifest, usage in data

Term/class **definitions** (their fixed values, taxonomy membership, hierarchy)
live in the manifest — they are a bounded vocabulary and the value-origin
authority. Term/user **instances** that *reference* a term live in the sharded
data graph via the node-root `class` ref. "Definitions in manifest, usage in
data."

## Logical data model

The logical manifest is a single JSON-shaped object. Typed precisely (TypeScript;
this is the in-memory / debug-JSON view — SPEC-04 gives the binary form):

```ts
/** Field / relationship multiplicity glyphs on the wire (JOURNAL contract). */
type CardGlyph = "1" | "?" | "*" | "+";   // One | Optional | Many | OneOrMore

interface FieldDef {
  /** Scalar field type — a primitive/concept id (a TypeInfo ref in SPEC-04). */
  type: string;
  card: CardGlyph;
}

interface RelationshipDef {
  /** One or more target concept ids (union). */
  targets: string[];
  card: CardGlyph;
  /** Name of the inverse relationship on the target, or omitted if none. */
  inverse?: string;
}

interface ConceptDef {
  /** Single direct parent id; null only for the root `Element`. */
  extends: string | null;
  /** DECLARED-OWN scalar fields, keyed by field name. */
  fields: Record<string, FieldDef>;
  /** DECLARED-OWN reference relationships, keyed by relationship name. */
  relationships: Record<string, RelationshipDef>;
  /** Opaque invariant expressions for v1 (see Open questions). */
  invariants: string[];
}

interface ClassDef {
  /** The concept this class/term is a partial instance of. */
  concept: string;
  /** The taxonomy this term belongs to, if any. */
  taxonomy?: string;
  /** Direct broader term (parent in the taxonomy), if any. */
  broader?: string;
  /** Direct narrower terms (children in the taxonomy). */
  narrower: string[];
  /** The field values this class pins — the Axis-2 value-origin authority. */
  fixed: Record<string, Scalar>;
}

interface TaxonomyDef {
  /** The concept(s) this taxonomy represents. */
  represents: string[];
  /** The root term id(s) of the taxonomy. */
  roots: string[];
}

interface Manifest {
  format: "todl-manifest/1";
  model: string;
  version: string;
  /** The virtual root; always "Element". */
  root: string;
  concepts: Record<string, ConceptDef>;
  classes: Record<string, ClassDef>;
  taxonomies: Record<string, TaxonomyDef>;
}

type Scalar = string | number | boolean;   // mirrors src/model/graph.ts:59
```

Notes:

- `card` glyphs are the wire form of the existing `Cardinality` enum
  (`src/model/graph.ts:51-56`). The JOURNAL fixes the glyph↔code mapping
  (`"1"→0, "?"→1, "*"→2, "+"→3`); the enum member for `"+"` is renamed
  `OneOrMore` in the redesign (JOURNAL "Enums") — this spec uses the glyph on the
  wire and defers the enum rename to SPEC-01/04.
- `fields` / `relationships` / `classes` / `taxonomies` are keyed maps in the
  logical view for legibility; SPEC-04 lowers them to explicit `[start,count]`
  member slices in the binary tables.
- **Deferred sections** (flagged, not modelled here — SPEC-04): annotation
  **definitions** vs **applications** (the manifest will grow an annotation-defs
  section and the data graph carries applications); and the `operators` /
  `viewpoints` / `models` / `package` sections (analogous shape, detailed with
  the binary format).

## Resolution algorithms

Both axes resolve against the logical maps above. Pseudocode (SPEC-04 gives the
pure-integer table-scan equivalents; SPEC-05 surfaces these as
`MemberInfo.declaringType` and `FieldView.valueOrigin`).

### Axis 1 — `typeOriginOf(type, field)` (subtype wins)

```
function ancestorsViaExtends(type):
    chain = []
    c = manifest.concepts[type].extends
    while c != null:
        chain.push(c)
        c = manifest.concepts[c].extends      // stops at Element (extends: null)
    return chain                               // [direct parent, ..., Element]

function typeOriginOf(type, field):
    for c in [type, ...ancestorsViaExtends(type)]:      // nearest first
        if field in manifest.concepts[c].fields:
            return c                            // first (nearest) declarer wins
    return undefined                            // not a declared field of `type`
```

The `[type, ...ancestors]` ordering makes **subtype wins**: an override
declared on a subtype is found before the supertype's declaration, mirroring the
current `effectiveSchema` "first writer wins" merge
(`src/model/model.ts:350-352`) — except the manifest returns the *declaring
concept* rather than discarding it. The same shape resolves relationship origin
(scan `concepts[c].relationships`).

### Axis 2 — `valueOriginOf(node, field)` (self vs class)

```
function valueOriginOf(node, field):
    C = node.class                              // Axis-2 hook on the node root
    if C == null: return "self"
    fixed = manifest.classes[C].fixed
    if field in fixed and fixed[field] === node.attrs[field]:
        return C                                // value came from the class/term
    return "self"                               // instance overrode or class doesn't pin it
```

This inverts the destructive overlay in `effectiveFields`
(`src/model/model.ts:246-258`): instead of merging class fixed-values *onto* the
node and losing provenance, the value is already flattened onto the node and we
*attribute* it by comparing against the class's `fixed` map. Equality is scalar
value equality (`===` over `Scalar`).

## Emit pipeline

A manifest + a flattened data graph are produced together from a `Repository`.
The pipeline is a new emitter module (proposed `src/emit/manifest.ts`,
sibling to `src/emit/json.ts`); it does **not** modify `toJSON`. It reuses the
existing schema-reflection surface on `Repository`:

**Manifest emission** (one pass over ontology-tier nodes):

1. **Concepts** — for every concept node (`typeOf === MetaKind.Concept`,
   `src/model/kinds.ts:7`), call `Repository.schemaOf(concept)`
   (`src/model/model.ts:315-344`), NOT `effectiveSchema`. `schemaOf` already
   returns **declared-only** members plus the single direct `extends` parent
   (`extends: parents[0] ?? null`, `src/model/model.ts:343`) — exactly the
   Axis-1 declared-only shape. Map each `FieldSchema`→`FieldDef` and
   `RelationshipSchema`→`RelationshipDef`, converting `Cardinality`→glyph.
   Attach `invariantsFor(concept)` (`src/model/model.ts:80-82`) as opaque
   expression strings.
2. **Element root** — do NOT emit the synthetic `Extends → Element` edge; emit
   `Element` as a concept with `extends: null` (idea #7 virtual root). Concepts
   whose only parent is the implicit `Element` get `extends: "Element"`.
3. **Classes / terms** — for every class node (`Repository.isClass`,
   `src/model/model.ts:187-190`), emit a `ClassDef`: `concept` = the node's
   `typeOf`; `fixed` = the node's own scalar attrs **minus** the structural
   markers (the same blocklist `effectiveFields` applies at
   `src/model/model.ts:253`, obsoleted once SPEC-01 moves markers to node root);
   `taxonomy` / `broader` / `narrower` from `narrowerOf` / `broaderOf`
   (`src/model/model.ts:166-173`) and the term's containing taxonomy
   (`termsOf` inverse, `src/model/model.ts:238-240`).
4. **Taxonomies** — for every taxonomy node (`typeOf === MetaKind.Taxonomy`),
   emit a `TaxonomyDef`: `represents` from `Repository.represents`
   (`src/model/model.ts:203-205`); `roots` = the taxonomy's top-level terms
   (`termsOf` filtered to those with no `broader`).

**Flattened data-graph emission** (one pass over instance-tier nodes): for each
instance node, resolve its effective fields via `effectiveFields`
(`src/model/model.ts:246-258`) and effective relationships via
`effectiveRelationships` (`src/model/model.ts:264-278`), writing:

- node = `{ id, type: node.typeOf, class?: classOf(node), namespace, attrs }`
  where `attrs` is **user-only** (structural markers moved to root per SPEC-01);
- edges = relationship-only `{ from, rel, to }` (the `via` member name becomes
  `rel`), i.e. only `EdgeKind.Relationship` edges survive
  (`src/model/model.ts:266-272` already filters to these).

`classOf` (`src/model/model.ts:192-195`) supplies the Axis-2 `class` hook. The
data graph pins the manifest with `manifestRef: { model, version }`.

> The redesign's declared-only manifest wants `effectiveSchema` only for
> *validation cross-checks*, never for manifest storage. Manifest storage uses
> `schemaOf` (declared-only); `effectiveSchema` / `effectiveFields` are reused
> for producing the **flattened data graph** (where resolution *is* applied).

> **Implementation reconciliation (2026-09-16).** Scalar flattening for the data
> graph is **instance-wins**, not `effectiveFields`. `Repository.effectiveFields`
> is **class-wins** (it overlays class fixed values *over* the leaf's own —
> `src/model/model.ts:246-258`, "class wins"). Under class-wins a class-fixed
> field on an instance *always* equals the class value, so Axis-2 `valueOriginOf`
> could never return `"self"` for it and the axis would be vacuous. The emitter
> therefore fills class fixed values only into fields the instance leaves unset,
> then lets the instance's own values override — the SPEC-01 target semantics.
> Test #4's oracle is the instance-wins overlay accordingly. `effectiveFields`
> remains the class-wins resolution for validation / typed clients;
> `effectiveRelationships` (a union) is reused unchanged for edges.

## JSON strawman

### `manifest.json` (replicated)

```json
{
  "format": "todl-manifest/1",
  "model": "shop",
  "version": "1.0.0",
  "root": "Element",
  "concepts": {
    "Element": { "extends": null, "fields": {}, "relationships": {}, "invariants": [] },
    "Component": {
      "extends": "Element",
      "fields": { "name": { "type": "string", "card": "1" },
                  "color": { "type": "string", "card": "?" } },
      "relationships": {
        "dependsOn": { "targets": ["Component"], "card": "*", "inverse": "usedBy" }
      },
      "invariants": ["name != \"\""]
    },
    "Surface": {
      "extends": "Component",
      "fields": { "color": { "type": "string", "card": "1" } },
      "relationships": {},
      "invariants": []
    }
  },
  "classes": {
    "Components.Surface": {
      "concept": "Component",
      "taxonomy": "ComponentKinds",
      "narrower": [],
      "fixed": { "color": "red" }
    }
  },
  "taxonomies": {
    "ComponentKinds": { "represents": ["Component"], "roots": ["Components.Surface"] }
  }
}
```

Here `Surface.color` overrides `Component.color` (subtype wins): its cardinality
tightens `?`→`1`, and `typeOriginOf("Surface", "color") === "Surface"`.

### `graph.json` (sharded)

```json
{
  "manifestRef": { "model": "shop", "version": "1.0.0" },
  "nodes": [
    { "id": "shop.header",
      "type": "Component",
      "class": "Components.Surface",
      "namespace": "shop",
      "attrs": { "name": "Header", "color": "red" } },
    { "id": "shop.footer",
      "type": "Component",
      "class": "Components.Surface",
      "namespace": "shop",
      "attrs": { "name": "Footer", "color": "blue" } }
  ],
  "edges": [
    { "from": "shop.header", "rel": "dependsOn", "to": "shop.footer" }
  ]
}
```

`attrs` is **user-only**. For `shop.header`, `valueOriginOf(header, "color")`
compares `attrs.color === "red"` against `classes["Components.Surface"].fixed.color
=== "red"` → origin = the class. For `shop.footer`,
`attrs.color === "blue" !== "red"` → origin = `"self"` (the instance overrode
the class fixed value).

This JSON is the **human-readable view only**; SPEC-04 gives the binary form
(tables + heaps, numeric tokens) that ships in packages. The two are round-trip
tested 1:1.

## Impact on existing code

- **Additive.** No change to `toJSON` / `fromJSON` / `TodlDocument`
  (`src/emit/json.ts`). The manifest emitter is a new module that consumes the
  same `Repository`.
- **Reuses** `Repository.schemaOf` / `effectiveSchema` / `effectiveFields` /
  `effectiveRelationships` / `classOf` / `isClass` / `narrowerOf` / `broaderOf` /
  `represents` / `termsOf` / `invariantsFor` — no new query primitives needed on
  `Repository` for v1.
- **Depends on SPEC-01 shape** for the *final* emitted node (structural markers
  at the node root, `attrs` user-only, `MetaKind.Term`). Until SPEC-01 lands, the
  emitter applies the same marker blocklist `effectiveFields` uses
  (`src/model/model.ts:253`) so it can target the current model first (per
  JOURNAL implementation order: SPEC-03 emitter runs against the current model,
  refined as SPEC-01/02 land).
- **No new edges** are introduced into the data graph; if anything, the flattened
  data graph *drops* `Extends` / `Contains` / `HasField` edges (SPEC-01/02).

## Testing strategy

Tests live in `src/emit/tests/` per the repo convention (CLAUDE.md). Build a
small `Repository` fixture (a two-level `Component`→`Surface` extends chain, a
class `Components.Surface` fixing `color`, a taxonomy, two instances — one taking
the class value, one overriding it), emit manifest + graph, then assert:

1. **Axis-1 origin round-trip** — `typeOriginOf("Surface", "name") === "Component"`
   (inherited) and `typeOriginOf("Surface", "color") === "Surface"` (declared on
   subtype). Assert the manifest's `concepts` map is **declared-only** (Surface's
   `fields` contains only `color`, not `name`).
2. **Subtype-wins override** — with `color` declared on both `Component` and
   `Surface`, `typeOriginOf("Surface", "color")` returns the nearest declarer
   `Surface`, and its `card` reflects the override (`"1"`, not `"?"`).
3. **Value-origin self-vs-class** — for the class-valued instance,
   `valueOriginOf(node, "color") === "Components.Surface"`; for the overriding
   instance, `valueOriginOf(node, "color") === "self"`. Also assert a field the
   class doesn't fix resolves `"self"`.
4. **Flatten fidelity** — emitted instance `attrs` equal
   `effectiveFields(leaf)` minus structural markers; relationship edges equal
   `effectiveRelationships(leaf)` flattened to `{from, rel, to}`.
5. **Element is a rule, not an edge** — the manifest contains
   `Element: { extends: null }` and NO instance/concept carries a materialized
   `Extends → Element` edge in the data graph.
6. **Manifest ↔ debug-JSON round-trip** — logical manifest → JSON → logical
   manifest is identity (foundation for SPEC-04's binary↔JSON round-trip).

## Open questions

- **Invariants encoding** — opaque expression strings for v1 (idea #9). The
  richer form (a compiled predicate blob referenced from `#Const`) is a SPEC-04
  concern; the logical shape reserves `invariants: string[]`.
- **Annotation defs vs applications** — the manifest will carry annotation
  **definitions**; annotation **applications** attach to concepts (manifest) and
  possibly instances (data graph). Split deferred to SPEC-04 (JOURNAL open
  questions).
- **`operators` / `viewpoints` / `models` / `package` sections** — analogous
  map/table shape, detailed with the binary format (SPEC-04).
- **`storageId` on data-graph nodes** — reserved but deferred (JOURNAL / idea #3):
  minting authority, reload stability, store role. The strawman uses logical `id`
  as the node key for now.
- **Multi-manifest field origins** — when a concept `extends` a concept from a
  *dependency* manifest, `typeOriginOf` must hop across manifests. The logical
  model here is single-manifest; cross-manifest resolution (Imports / TypeRef,
  `DomainToken`) is SPEC-04/06.

## Implementation tasks (bite-sized, TDD)

Each task = one failing test first, then the code (per repo TDD convention).

1. **Logical types** — add the `Manifest` / `ConceptDef` / `ClassDef` /
   `RelationshipDef` / `FieldDef` / `TaxonomyDef` interfaces + `CardGlyph`
   mapping helpers (`Cardinality`↔glyph). Test the glyph mapping round-trips all
   four cardinalities.
2. **`typeOriginOf`** — implement over a hand-built `Manifest` literal; tests for
   inherited field, declared-on-subtype field, override (subtype wins), and
   unknown field (`undefined`).
3. **`valueOriginOf`** — implement over a `Manifest` + a flattened node literal;
   tests for class-valued (origin = class), overridden (`"self"`),
   class-doesn't-fix (`"self"`), and no-class (`"self"`).
4. **Concept emission** — emit `concepts` from a `Repository` using `schemaOf` +
   `invariantsFor`; test declared-only fields, single `extends`, `Element` as
   `extends: null`, cardinality-glyph conversion.
5. **Class + taxonomy emission** — emit `classes` / `taxonomies` from `isClass` /
   `classOf` / `narrowerOf` / `broaderOf` / `represents` / `termsOf`; test
   `fixed` excludes structural markers and taxonomy `roots` are broader-less
   terms.
6. **Flattened data-graph emission** — emit `nodes` (user-only `attrs`, `type`,
   `class`, `namespace`) + relationship-only `edges` via `effectiveFields` /
   `effectiveRelationships` / `classOf`; test flatten fidelity and no
   inheritance edges.
7. **End-to-end origin round-trip** — build the fixture `Repository`, emit both
   artifacts, run `typeOriginOf` / `valueOriginOf` against the emitted manifest +
   nodes; assert the six testing-strategy properties.
8. **Debug-JSON round-trip** — serialize the logical manifest to JSON and back;
   assert identity (hands off to SPEC-04 for binary↔JSON).
```
