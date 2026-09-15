# SPEC-02 — Inheritance Flattening & Virtual Element

Covers idea **#7** (don't materialize the implicit `Extends → Element` edge).
Sibling of **SPEC-01** (node & edge model), **SPEC-03** (manifest model, where the
concept→parent hierarchy is *preserved*), and **SPEC-04** (manifest binary format).
Names are taken verbatim from the JOURNAL naming contract.

> **Design is already decided.** This spec transcribes and structures it against
> the current code. It does not re-open the design.

---

## 1. Goal

Make the emitted **data graph self-contained and shardable** by (a) resolving each
node's effective field set at **compile time** and flattening it onto the node, and
(b) treating "every parent-less concept is an `Element`" as a **virtual root rule**
resolved by the compiler/runtime rather than a stored edge. After this spec the
data graph carries **no** `Extends`, `Element`, `Contains`, or `HasField`-for-scalars
edges. All type/structure information that flattening removes from the data graph is
preserved — losslessly — in the **manifest** (SPEC-03/04), so validation, reflection,
subtype queries, and round-trip all keep working.

The universal super-type edge is the concrete target here (`Element`), but the rule
is general: **any** universal super-type relationship becomes a virtual rule + index,
never a stored super-node.

---

## 2. Motivation & current state

### 2.1 The synthetic `Extends → Element` edge

Today the loader fills a parent-less concept's missing base with the prelude root
`Element`:

- `src/parse/loader.ts:519-527` — `case DeclKind.Concept`: the comment reads *"A
  parent-less concept implicitly extends the prelude root `element` (when it is in
  scope)"*, and

  ```ts
  const parent = declaration.extends
    ?? (declaration.name !== "Element" && model.has("Element") ? "Element" : null);
  first.defineConcept(declaration.name, parent);
  ```

- `src/model/builder.ts:131-137` — `defineConcept` stages the edge:

  ```ts
  this.stagedEdges.push({ kind: EdgeKind.Extends, via: null, from: id, to: extendsId });
  ```

- `src/stdlib/prelude.todl:29-34` — the `Element` root concept (`label`,
  `description`), *"implicit supertype of every parent-less concept."*

So **every** parent-less concept gets a real `Extends` edge whose `to` is `Element`.

### 2.2 The super-node problem

`Element`'s reverse adjacency (`inEdges` for `EdgeKind.Extends`, `Direction.In`) holds
**one entry per concept in the whole ontology**. That is a textbook super-node: a write
hotspot (every concept touches it), a fan-out / IO bottleneck, and a single point of
failure / blast radius on that one node's storage.

The kicker: **that reverse adjacency is never used for inheritance resolution.**
Resolution walks **outward** from a concept, reading only a concept's own parent edge:

- `src/model/model.ts:161-163` — `supertypesOf` = `closure(concept, Extends, Direction.Out, false)`.
- `src/model/model.ts:315-344` — `schemaOf` reads the concept's own `Extends`-Out parent
  plus its own `HasField` / `HasRelationship` members.
- `src/model/model.ts:346-365` — `effectiveSchema` merges `[concept, ...supertypesOf(concept)]`
  (again outward), subtype-wins.

`Element`'s **in**-edges answer only "list every concept" — rare, and derivable. So the
stored implicit edge is close to pure liability: write cost + storage bloat + super-node,
with no common-path read benefit.

### 2.3 Distributed-storage motivation

Picture a distributed graph store sharded **table-per-type** (each node kind → its own
table). Edge-based inheritance forces a **central `Elements` table with one row per node
in the whole graph** — either because the `Extends` edges all land there, or because
class-table-inheritance splits every entity's base fields into `Elements` joined by id.
That central table is exactly the hotspot / SPOF / scaling ceiling: sharding buys nothing
because one table still sees all traffic.

If inheritance is a **virtual rule** (not a stored edge), there is no `Elements` table:
each node lives wholly in its own type table, writes fan out evenly across shards, and no
single table sees the whole graph.

### 2.4 The trade-off (named)

"**all Elements / all nodes**" becomes a **scatter-gather across type tables** instead of
one central scan — the right trade for a distributed store (swap a *guaranteed* bottleneck
for a *rare* fan-out), and it is derivable via union / index. This applies to **any**
universal super-type edge, not just `Element`.

---

## 3. Design

Three separable decisions, all resolved at compile time.

### 3.1 Compile-time field flattening

Each emitted **instance** node carries its **effective scalar field set** (own attrs
overlaid with everything inherited from its concept chain and its class/term fixed
values) directly in `attrs`. A read consumer (validation-free "just render", traversal)
needs **no** inheritance walk and **no** manifest to see a node's fields — the node is
self-contained.

- Flattening is applied to the **data graph** (instance tier).
- The **concept schema** itself is *not* flattened into the data graph; it is stored
  **declared-only** in the manifest (own members + single `extends` parent) — see §6.
  Effective schema is recomputed by walking the tiny concept chain in the manifest when
  a consumer needs it (validation / reflection). This keeps the manifest small and the
  hierarchy exact for subtype queries and round-trip.

### 3.2 Virtual `Element` root rule

"Everything is an `Element`" is an **implicit language rule / virtual root**, resolved by
compiler/runtime, **not persisted**:

- Persist only **explicit** `extends`. A concept with a declared parent keeps its single
  stored `Extends` edge (in the manifest hierarchy, per SPEC-03 — not in the data graph).
- A **parent-less** concept has **no** stored parent. Its base is `Element` **by rule**.
- `Element` itself extends nothing (`Element extends null`); it is a root/rule, never an
  edge target in the persisted graph.
- Root / "is-an-`Element`" checks apply the universal rule instead of reading N edges:
  a concept with no explicit parent *is* rooted at `Element`; `isElement(x)` is always
  true.

This is the same theme as the sibling ideas (#1/#5/#6): **language meta-information stays
out of the materialized graph.**

### 3.3 Edges removed from the data graph

After this spec, the **data graph** (SPEC-01 instance tier) carries **no**:

- `Extends` edges (concept hierarchy → manifest, not data),
- `Element` node or any edge to it (virtual rule),
- `Contains` edges for scalars, and no `HasField` edges for scalars (SPEC-01 idea #4:
  scalar → `attrs`, reference → real relationship edge).

The data graph retains only **relationship / reference** edges — the `EdgeKind` set the
naming contract keeps (`Relationship`, `Narrower`, `InstanceOf`, `Targets`, `Represents`,
`Annotated`, `Frames` as applicable). `Extends` / `Contains` / `HasField` /
`HasRelationship` cease to appear as **persisted data-graph** edges; where they still
describe *structure* they live in the manifest tables (SPEC-04: `TypeInfo.extends`,
`Field`, `Rel`, `Taxonomy`, `Class`).

> Note on scope boundary with SPEC-04: the manifest expresses `extends` as the
> `TypeInfo.extends` **coded index** (`TypeDefOrRef`), not as a graph edge. `Element`
> being a rule means a parent-less concept's `TypeInfo.extends` column is `0` (null/none)
> — the reader applies the virtual-root rule to treat `0` as "rooted at `Element`".

---

## 4. Algorithms

### 4.1 Flattening the effective field set (at emit)

Reuse/extend the existing effective-resolution logic. Two layers already exist:

1. **Concept-chain field resolution** — `Repository.effectiveSchema`
   (`src/model/model.ts:346-365`) merges `[concept, ...supertypesOf(concept)]`,
   subtype-wins (nearest declarer of a field name is kept). This is the **Axis-1**
   (type/field-definition) walk. It is used to compute the manifest's *declared*
   view and, transiently, the effective field **names/types** an instance must carry.

2. **Instance value overlay** — `Repository.effectiveFields`
   (`src/model/model.ts:246-258`) overlays a leaf's own attrs with its class's fixed
   values (`classOf` via `InstanceOf`), class-wins. This is the **Axis-2**
   (value-origin) overlay.

**Emit algorithm for an instance node `n` typed by concept `C` (class `K = classOf(n)`):**

```
effective_attrs(n):
    result = new Map(own attrs of n)                    # instance's own scalar writes
    if K != null:
        for (key, value) in fixed-scalar-attrs(K):      # class/term fixed values
            result.set(key, value)                      # class-wins overlay
    # (defaults from the concept chain, if any, fill unset scalar field slots)
    return result
```

Concretely this is **`effectiveFields(n)`** — but with the **blocklist deleted**. Today
`effectiveFields` must skip the `class` / `id` markers:

```ts
// src/model/model.ts:253 (current)
if (key !== "class" && key !== "id") result.set(key, value);
```

Under SPEC-01 those markers move to node **root** fields (`isClass`, `localId`) out of
`attrs`, so the overlay becomes a **clean overlay with no blocklist**. This spec depends
on SPEC-01 having relocated them; the flattening emitter must **not** re-introduce a
blocklist and must **not** copy any structural marker into `attrs` (attrs are user-only,
per the founding principle).

The **field name/type/cardinality** the flattened value conforms to is *not* copied onto
the node — that is `TypeInfo.extends` + `Field` in the manifest (§6). Flattening writes
**values**, the manifest holds **shape**.

### 4.2 Applying the virtual `Element` rule (at emit + read)

**At emit (loader):** stop injecting `Element` as the synthetic parent.

- A concept with an explicit `extends` → stage its single explicit parent (manifest
  hierarchy).
- A parent-less concept → stage **no** parent; its manifest `TypeInfo.extends = 0`
  (null/none).
- `Element` remains a declared concept in the prelude/manifest (it still owns the
  `label` / `description` fields that flatten onto every node), but nothing stores an
  edge *to* it.

**At read (manifest/runtime):** the virtual-root rule is a pure function, no edge reads:

```
supertypeOf(type):                 # single step
    if type.extends != 0: return type.extends
    if type == Element:  return null       # Element is the root
    return Element                         # virtual rule: parent-less ⇒ Element

isElement(type): true              # universal
rootOf(type): Element
```

This replaces the *stored* `Extends → Element` edge with a *computed* one at exactly the
site (`schemaOf` / `supertypesOf`, `src/model/model.ts:161-163, 315-344`) that already
walks outward. The walk gains a final synthetic "…and then `Element`" step instead of
reading it from adjacency.

### 4.3 Where the walk still needs `Element`'s fields

Because `Element` contributes real fields (`label`, `description`), the effective-schema
walk (§4.1 layer 1) must still **include `Element`** as the final supertype for every
concept — via the rule (§4.2), not via a stored edge. That is the only place `Element`
enters resolution; there is never a reverse `Element` read.

---

## 5. Impact on existing code

> This spec **does not** modify source; the tasks below are the implementation contract.
> SPEC-02 is sequenced **last** in the JOURNAL implementation order (after the manifest
> pipeline 04/03/05/06 exists to consume the cleaned shape).

### 5.1 `src/parse/loader.ts` — implicit-extends removal / relocation

- `loader.ts:519-527` (`case DeclKind.Concept`): **remove** the `?? "Element"` fallback.
  Pass the **declared** parent only (`declaration.extends ?? null`). The parent-less case
  now yields a concept with **no** stored parent.
- The behavior tested by `src/parse/tests/implicit-element.test.ts` (`supertypesOf("Thing")`
  includes `"Element"`) must be **preserved through the rule**, not the edge — i.e.
  `supertypesOf` must apply the virtual-root rule (§4.2) so the assertion still holds.
  Update the test's *rationale* comment; the assertion stays green.

### 5.2 `src/model/model.ts` — resolution via rule, blocklist removal

- `supertypesOf` (`161-163`) and the `schemaOf` extends read (`315-317`): append the
  virtual-`Element` step so a parent-less concept still resolves `Element` and its fields,
  with **zero** reverse-adjacency dependence.
- `effectiveFields` (`246-258`): **delete** the `class` / `id` blocklist once SPEC-01
  relocates those markers to root fields — the overlay becomes clean. If SPEC-01 lands
  first (per the JOURNAL order it does not, but if sequencing shifts) keep them consistent.
- `effectiveSchema` (`346-365`): unchanged in shape, but its `supertypesOf` input now
  includes `Element` by rule for parent-less concepts — verify the merge still terminates
  and `Element` is included exactly once.

### 5.3 `src/model/builder.ts` — no synthetic Extends staging

- `defineConcept` (`131-137`) still stages an explicit `Extends` edge **only** when
  `extendsId !== null`. No change to the guard itself; the change is that the loader no
  longer *passes* `Element` as `extendsId`. (This edge is a *build-time / manifest*
  hierarchy edge; SPEC-04 relocates persisted hierarchy to `TypeInfo.extends`.)

### 5.4 Emit — flattening + edge omission

- The **data-graph** emit path (JSON emitter `src/emit/json.ts:114-126` / `toJSONOwn`
  `134-151`, and the manifest data-graph emitter in SPEC-03) must:
  1. write each instance node's `attrs` as the **flattened effective scalar set**
     (§4.1), and
  2. **omit** `Extends`, `Contains`, `HasField`, `HasRelationship` edges from the
     data-graph output — only relationship/reference edges survive.
- `Element` is never emitted as a node in the data graph and never appears as an edge
  target there.
- The **manifest** emitter (SPEC-03) captures the declared concept hierarchy + declared
  members separately, so structure is not lost.

### 5.5 Consumers reading `Element`/`Extends`

- `src/model/element.ts` (`toElement`, `ElementSchema.extends`): its `schema.extends`
  comes from `Repository.schemaOf().extends`. After the rule, a parent-less concept's
  `extends` is reported as `Element` **by rule** (or `null` for `Element` itself). Confirm
  `schemaOf` returns the rule-derived parent so `ElementSchema` is unchanged for consumers.
- `src/validate/validate.ts:177` (`validateAnnotationDecl`) reads `Extends`-Out for
  **annotations**, not concepts, and annotations have **no** implicit `Element` base
  (`defineAnnotation`, `builder.ts:74-81`, only stages when explicit). Unaffected — but
  the spec must not accidentally give annotations a virtual `Element` parent.

---

## 6. Interaction with the manifest (SPEC-03)

Flattening **loses nothing** because everything it strips from the data graph is preserved
in the manifest:

- **Concept hierarchy** (Axis 1): SPEC-03's `concepts` map keeps each concept's single
  `extends` parent; SPEC-04 encodes it as `TypeInfo.extends` (coded index `TypeDefOrRef`).
  `Element extends null`; parent-less concept → `extends = 0` + virtual-root rule.
- **Declared members**: SPEC-03 stores **declared-only** fields/relationships
  (`Field`, `Rel`, `Target` tables in SPEC-04); effective schema is recomputed by walking
  the tiny concept chain (§4.1) — never at data-graph read time.
- **Class/term fixed values** (Axis 2): SPEC-03's `classes` map keeps each class/term's
  `fixed` values (SPEC-04 `Class` + `Fixed` tables), so a flattened instance value can be
  attributed to its class/term (`valueOrigin = class`) or to the instance (`valueOrigin =
  "self"`).
- Instance nodes carry `type` (concept `TypeInfo` token) and optional `class`
  (`Class`/`TermInfo` token) as **root fields** (SPEC-01), the hooks the two provenance
  axes resolve through — structural, not `HasField` edges.

So: **data graph = flattened values; manifest = shape + hierarchy + fixed-value origins.**
"Just render" reads the sharded data graph and ignores the manifest; validation/reflection
read the tiny replicated manifest.

---

## 7. Testing strategy

1. **Rule preserves `supertypesOf`** — port `implicit-element.test.ts`: a parent-less
   `concept Thing {}` still has `supertypesOf("Thing")` include `"Element"`, with **no
   stored `Extends` edge to `Element`** in the graph (assert the edge's absence directly).
2. **`Element` has no self-edge / no reverse blowup** — `supertypesOf("Element")` excludes
   `Element`; `Element`'s in-adjacency for `Extends` is **empty** (was N; now 0).
3. **Explicit parent still resolves transitively** — `concept Sub : Base {}` →
   `supertypesOf("Sub")` includes both `Base` and `Element` (Base via edge, Element via
   rule).
4. **Flattened instance is self-contained** — an instance of a concept that extends
   `Element` carries `label`/`description` slots (when set) in `attrs` after emit, with
   no inheritance walk and no manifest needed to read them.
5. **Flatten value-origin** — an instance of a class with a `fixed` value shows the class
   value in flattened `attrs` (class-wins), and its own override wins over the class.
6. **No blocklist leakage** — after SPEC-01 relocation, flattened `attrs` contain **no**
   `class` / `id` / `namespace` structural keys (attrs are user-only).
7. **Edge omission** — the emitted **data graph** contains **no** `Extends` / `Contains` /
   `HasField` / `HasRelationship` edges and **no** `Element` node; it contains only
   relationship/reference edges.
8. **Round-trip via manifest** — declared hierarchy + members reconstructed from the
   manifest reproduce the same effective schema as `effectiveSchema` computes today
   (parity test: pre-flattening `effectiveSchema(C)` == manifest-walked effective schema).
9. **Distributed-shape smoke** — grouping data-graph nodes by `type` yields disjoint sets
   with **no** shared central `Element`/`Elements` bucket (the "no central table" property).

---

## 8. Open questions

- **Does anything rely on `Element`'s reverse edges?** Audit found none on the common path:
  resolution walks outward (`model.ts:161-163, 315-344`); `element.ts` reads `schema.extends`
  (outward). The only reverse use is "list all concepts," which is **rare and derivable**.
  Provide it via a **rule/index**, not a super-node:
  - "all concepts" / "all `Element`s" = **union / scatter-gather** over the per-type node
    sets (or a maintained index), per the named trade-off (§2.4) — never a scan of an
    `Element` in-adjacency.
  - If a consumer needs a materialized "all concepts" list, the **manifest** already holds
    the full concept set (replicated, concepts-only, dozens–hundreds) — read it there, not
    from the sharded data graph.
- **Annotations and `Element`.** Confirmed annotations do **not** get a virtual `Element`
  base (they root at their own `Annotation` meta-kind). The virtual-root rule is
  **concept-scoped**; do not generalize it to annotation declarations.
- **Defaults vs fixed values in flattening.** Whether concept-level field **defaults**
  (if any exist) are flattened onto instances, or only class **fixed** values are — align
  with SPEC-03's `fixed` semantics. (v1: flatten class `fixed` + instance own; concept
  defaults deferred unless SPEC-03 defines them.)
- **`storageId` interaction.** Deferred per JOURNAL; flattening writes `attrs` values only
  and is orthogonal to `storageId` minting.

---

## 9. Implementation tasks (bite-sized, TDD)

Each task = a failing test first, then the change. Sequenced after the manifest pipeline
(JOURNAL order): the emitter/reader (SPEC-04/03) exists to consume the cleaned shape.

1. **T1 — virtual-root rule in resolution.** Add the "parent-less ⇒ `Element`" step to
   `supertypesOf` / `schemaOf` (`model.ts:161-163, 315-317`). Test: `supertypesOf("Thing")`
   includes `Element` with the fallback removed from the loader (T2 pairs with this).
2. **T2 — drop synthetic `Element` in loader.** Change `loader.ts:524-526` to
   `declaration.extends ?? null`. Test: no `Extends` edge to `Element` exists for a
   parent-less concept; T1's assertion still green.
3. **T3 — `Element` self-loop / empty reverse.** Test `Element` in-adjacency for `Extends`
   is empty and `supertypesOf("Element")` excludes `Element`.
4. **T4 — clean overlay (blocklist removal).** After SPEC-01 relocates `class`/`id` to
   root, delete the blocklist in `effectiveFields` (`model.ts:253`). Test: overlay of a
   user attr literally named `class` is no longer dropped; markers are absent from `attrs`
   because they are root fields.
5. **T5 — flatten emit (values).** In the data-graph emitter, write flattened effective
   scalar attrs per instance (§4.1). Test: instance `attrs` include inherited/fixed values;
   own override wins.
6. **T6 — edge omission.** Data-graph emitter omits `Extends`/`Contains`/`HasField`/
   `HasRelationship` and never emits an `Element` node. Test: emitted doc has only
   relationship/reference edges.
7. **T7 — manifest structure parity.** Verify effective schema rebuilt from the manifest
   (declared members + `TypeInfo.extends` + virtual-root rule) equals pre-flattening
   `effectiveSchema(C)` for a fixture with 2–3 levels of `extends`. (Depends on SPEC-03.)
8. **T8 — "all concepts" via manifest/union.** Provide/point the "list all concepts"
   consumer at the manifest concept set (or per-type union), and assert no data-graph
   `Element` reverse read is performed.
9. **T9 — annotation guard.** Test an annotation declaration gets **no** virtual `Element`
   parent (regression guard for §5.5 / §8).
