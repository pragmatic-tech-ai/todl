# SPEC-05 — Reflection API

> Part of the [Graph Engine Redesign](JOURNAL.md). Covers **idea #11**.
> Layer: `Domain (SPEC-06) → Manifest(s) → **Reflection API (this spec)** → Graph`.
> Names are BINDING per the [JOURNAL naming contract](JOURNAL.md#shared-naming-contract-binding-across-all-specs);
> use them verbatim.

## 1. Goal

A **read-only, lazy reflection surface** over a single loaded manifest — modelled
one-to-one on .NET `System.Reflection`. It is the API through which every
consumer (validation, agents, presentation, round-trip, the `Domain`) asks a
manifest "what is this type / member / term, and where did this instance's value
come from?"

The literal deliverable is the **two-axis provenance answer** for a node's
fields, surfaced at the point of use by `InstanceMirror` / `FieldView`:

- **Axis 1 — type/field-definition origin** ("which concept *declared* this
  field?"). Travels `extends`. Surfaced as `MemberInfo.declaringType`.
- **Axis 2 — value origin** ("did this flattened value come from the node's
  class/term, or is it the instance's own?"). Travels `class`/`instanceOf`.
  Surfaced as `FieldView.valueOrigin`.

Everything in this API is a **lazy handle**: a `(Manifest, numeric row/token)`
pair. No object graph is eagerly materialised; every accessor is a numeric table
lookup against the SPEC-04 tables/heaps. Handles are value-comparable by
`.token`. **Nothing here mutates** — authoring/emit is a separate writer that is
explicitly out of scope for this spec (it consumes SPEC-03/04, not this API).

Scope boundary:

- **This spec** = the read API over a *loaded* manifest (SPEC-03 logical model /
  SPEC-04 binary tables).
- **SPEC-04** owns the table/heap byte format and the token scheme; this spec
  consumes it.
- **SPEC-06** owns cross-manifest resolution (`TypeRef`/`Imports` hops,
  `DomainToken`); a `Manifest` holds a back-link to its `Domain` so `baseType`
  can hop into a dependency manifest, but the hop mechanism itself is SPEC-06.

## 2. .NET → TODL mapping

| .NET `System.Reflection`            | TODL Reflection API                    | Notes |
|-------------------------------------|----------------------------------------|-------|
| `Assembly`                          | `Manifest`                             | the loaded metadata unit |
| `Type`                              | `TypeInfo`                             | concept / primitive / taxonomy / … |
| `Type.BaseType`                     | `TypeInfo.baseType`                    | the single `extends` parent; `undefined` for `Element` |
| `Type.GetFields(BindingFlags.DeclaredOnly)` | `TypeInfo.getDeclaredFields()` | own members only, no `extends` walk |
| `Type.GetFields()`                  | `TypeInfo.getFields()`                 | effective — walks `baseType`, override→nearest wins |
| `Type.IsSubclassOf(t)`             | `TypeInfo.isSubtypeOf(t)`              | strict, transitive over `extends` |
| `Type.IsAssignableFrom(t)`         | `TypeInfo.isAssignableFrom(t)`         | reflexive; `this` is assignable from `t` |
| `MemberInfo.DeclaringType`          | `MemberInfo.declaringType`             | **= Axis-1 type-origin** (no separate call) |
| `MemberInfo.ReflectedType`          | `MemberInfo.reflectedType`             | the `TypeInfo` the member was *obtained through* |
| `MemberInfo.MetadataToken`          | `MemberInfo.token` (and `TypeInfo.token`) | numeric row/token; identity |
| `FieldInfo`                         | `FieldInfo`                            | a scalar field (→ `attrs`) |
| `FieldInfo.GetValue(obj)`           | `FieldInfo.getValue(node)`             | effective scalar value on an instance |
| `PropertyInfo`                      | `RelationshipInfo`                     | a reference member (→ edges) |
| `PropertyInfo` value read           | `RelationshipInfo.getTargets(node)`    | resolved edge targets on an instance |
| `CustomAttributeData`               | `AnnotationInfo`                       | an applied annotation (`type` + `args`) |
| `Type.GetCustomAttributesData()`    | `TypeInfo.getAnnotations()` / `MemberInfo.getAnnotations()` | |
| *(no .NET analog)*                  | `TermInfo`                             | taxonomy term / class — Axis-2 value provider |
| *(no .NET analog)*                  | `TaxonomyInfo`                         | the bounded vocabulary a term belongs to |
| *(no .NET analog)*                  | `InstanceMirror` + `FieldView.valueOrigin` | **Axis-2 value-origin** at point of use |
| `AppDomain` / `AssemblyLoadContext` | `Domain` (SPEC-06)                     | not this spec |

## 3. API

All types below live in a new module (e.g. `src/manifest/reflection/`). They are
classes (per the OOP house style): a handle holds a private `Manifest` reference
plus its numeric row/token and exposes accessors that read the SPEC-04 tables.
Signatures use the shared enums `MetaKind` and `Cardinality`
([JOURNAL](JOURNAL.md#enums)) and the graph `Node` / `NodeId` / `Scalar` types.

```ts
import { MetaKind } from "../../model/kinds.js";
import { Cardinality } from "../../model/graph.js";
import type { Node, NodeId, Scalar } from "../../model/graph.js";

/** A metadata token: a numeric (table, row) address, stable within one Manifest. */
export type Token = number;
```

> `Token` here is the **intra-manifest** token (SPEC-04). The cross-manifest
> `DomainToken = (manifestId, table, row)` is SPEC-06; `resolveToken` on a
> `Manifest` takes the intra-manifest `Token`, while the `Domain` widens it.

### 3.1 `Manifest`

The reflection root — the `Assembly` analog. Wraps the SPEC-03 logical model (or
the SPEC-04 binary/JSON it was loaded from) and hands out lazy `TypeInfo` /
`TermInfo` / `TaxonomyInfo` handles.

```ts
export class Manifest {
  /** Load from the SPEC-04 binary container or JSON debug view. */
  static load(source: Uint8Array | ManifestJson): Manifest;

  /** The model identity (`model` header field), e.g. "shop". */
  readonly model: string;
  /** The model version (`modelVer` header field), e.g. "1.4.0". */
  readonly version: string;

  /** The virtual root type — `Element` (SPEC-04 header `root`). Its baseType is undefined. */
  root(): TypeInfo;

  /** Every TypeInfo row in this manifest (concepts, primitives, taxonomies, …). */
  types(): TypeInfo[];
  /** Resolve a type by simple or fully-qualified name; undefined if absent. */
  getType(name: string): TypeInfo | undefined;

  /** Turn any intra-manifest token back into its handle (TypeInfo / FieldInfo / …). */
  resolveToken(token: Token): TypeInfo | MemberInfo | TermInfo | TaxonomyInfo | undefined;

  /** Every taxonomy declared in this manifest. */
  taxonomies(): TaxonomyInfo[];
  getTaxonomy(name: string): TaxonomyInfo | undefined;
  /** A term (Class-table row) by its logical id, e.g. "Components.Surface". */
  getTerm(id: NodeId): TermInfo | undefined;

  /** The Axis-1 + Axis-2 payoff: reflect a data-graph node into a mirror. */
  reflect(node: Node): InstanceMirror;
}
```

Per-member semantics:

- `load` — parses the SPEC-04 container (binary) or its JSON mirror. Both round
  trip to the same in-memory tables (SPEC-04 guarantee); this method only picks
  the reader by discriminating `Uint8Array` vs object.
- `root()` — returns the `TypeInfo` at the header `root` token (`Element`). Its
  `baseType` is `undefined` because the universal `extends → Element` rule is
  *virtual* (idea #7): `Element` is the top, not an edge.
- `getType(name)` — matches simple name first, then `fullName` (`namespace.name`)
  to disambiguate. Names come from `#Strings`; the lookup compares string-heap
  indices, not JS strings, where possible.
- `resolveToken` — dispatches on the token's table tag to the right handle class.
  `token === 0` → `undefined` (0 = null/none, SPEC-04).
- `reflect(node)` — the entry point to the two-axis answer; see §3.9.

### 3.2 `MemberInfo` (abstract)

The `MemberInfo` analog — shared base of `FieldInfo` and `RelationshipInfo`.

```ts
export abstract class MemberInfo {
  /** The member's declared name (from #Strings). */
  abstract readonly name: string;
  /** This member's token (Field-row or Rel-row token). Identity. */
  abstract readonly token: Token;

  /**
   * AXIS 1. The TypeInfo that *declared* this member — the concept whose
   * [fieldStart,fieldCount) / [relStart,relCount) slice contains this row.
   * This IS the Axis-1 resolver; there is no separate "originOf" call.
   */
  abstract readonly declaringType: TypeInfo;

  /**
   * The TypeInfo this member was *obtained through* (the receiver of
   * getFields()/getRelationships()). Equals declaringType for a declared member;
   * differs for an inherited member surfaced via a subtype's effective view.
   */
  abstract readonly reflectedType: TypeInfo;

  /** Annotations applied to this member (SPEC-04 annotation-application rows). */
  abstract getAnnotations(): AnnotationInfo[];
}
```

`declaringType` vs `reflectedType` mirror .NET exactly: reflect `Component`'s
effective fields and an inherited `name` field comes back with
`declaringType = Element` (Axis 1) but `reflectedType = Component`.

### 3.3 `FieldInfo : MemberInfo`

A **scalar** field — one that lands in the node's `attrs` (idea #4: scalar→attr).

```ts
export class FieldInfo extends MemberInfo {
  /** The field's declared value type (a primitive/concept TypeInfo). */
  readonly fieldType: TypeInfo;
  /** Multiplicity glyph as an enum. */
  readonly cardinality: Cardinality;

  /**
   * The effective scalar value this field has on `node`: node.attrs[name] if
   * present, else the fixed value from node.class (Axis-2 fallback), else
   * undefined. (Value only — provenance is FieldView.valueOrigin.)
   */
  getValue(node: Node): Scalar | undefined;
}
```

### 3.4 `RelationshipInfo : MemberInfo`

A **reference** member — one that materialises as edges (idea #4:
reference→edge). The `PropertyInfo` analog.

```ts
export class RelationshipInfo extends MemberInfo {
  /** The allowed target types (Rel → Target slice). One or more. */
  readonly targets: TypeInfo[];
  readonly cardinality: Cardinality;
  /** The inverse member name on the far side, or null (Rel.inverse from #Strings). */
  readonly inverse: string | null;

  /** The resolved edge targets of this relationship on `node` (as NodeIds). */
  getTargets(node: Node): NodeId[];
}
```

`getTargets` reads the node's relationship edges filtered by `via === name`
(the data graph carries relationship-only edges, SPEC-01/02).

### 3.5 `TypeInfo`

The `Type` analog — a row in the `TypeInfo` table (concept, primitive, taxonomy,
annotation, …; distinguished by `kind`).

```ts
export class TypeInfo {
  readonly name: string;
  readonly namespace: string;
  /** "namespace.name" (or just name when namespace is empty). */
  readonly fullName: string;
  readonly kind: MetaKind;
  readonly token: Token;

  /** The single `extends` parent, or undefined for Element (virtual root). */
  readonly baseType: TypeInfo | undefined;

  // ── members ──────────────────────────────────────────────────────────
  /** DeclaredOnly: this type's own field rows [fieldStart,fieldCount). */
  getDeclaredFields(): FieldInfo[];
  /** Effective: own + inherited via baseType; override→nearest declarer wins. */
  getFields(): FieldInfo[];
  getField(name: string): FieldInfo | undefined; // effective lookup

  /** DeclaredOnly relationships [relStart,relCount). */
  getDeclaredRelationships(): RelationshipInfo[];
  /** Effective relationships (own + inherited; override→nearest wins). */
  getRelationships(): RelationshipInfo[];

  /** Effective fields ∪ relationships, as MemberInfo. */
  getMembers(): MemberInfo[];

  // ── subtype algebra ──────────────────────────────────────────────────
  /** Strict, transitive: this is a proper subtype of `other` via extends. */
  isSubtypeOf(other: TypeInfo): boolean;
  /** Reflexive: `this` is assignable FROM `other` (other == this or subtype). */
  isAssignableFrom(other: TypeInfo): boolean;
  /** The extends chain upward, excluding self, ending at Element. */
  getSupertypes(): TypeInfo[];

  // ── metadata ─────────────────────────────────────────────────────────
  /** Declared invariants (opaque expression blobs for v1, SPEC-03/04 open Q). */
  getInvariants(): string[];
  getAnnotations(): AnnotationInfo[];
}
```

Per-member semantics of note:

- `baseType` may hop a `TypeRef` into a dependency manifest via the `Domain`
  back-link (SPEC-06). Within one manifest it reads the `TypeInfo.extends`
  coded index directly.
- `getFields()` — see §4.1 for the exact resolution against SPEC-04 tables.
- `isAssignableFrom(other)` — `true` iff `other === this ||
  other.isSubtypeOf(this)`. This is the direction .NET uses (`base.IsAssignableFrom(derived)`).
- `getSupertypes()` follows `baseType` until `undefined`; `Element` is included
  (it is a real `TypeInfo` row), the virtual "everything extends Element" step
  is not re-materialised beyond that single row.

### 3.6 `TermInfo`

A taxonomy term / class — a row in the `Class` table. The **Axis-2 value
provider**: it pins `fixed` field values that a flattened instance can be
attributed to. No .NET analog.

```ts
export class TermInfo {
  /** The term's logical id, e.g. "Components.Surface". */
  readonly id: NodeId;
  readonly token: Token;
  /** The concept this term is-a class of (Class.type → TypeInfo). */
  readonly concept: TypeInfo;
  /** The taxonomy this term belongs to (Class.taxonomy → Taxonomy), or undefined. */
  readonly taxonomy: TaxonomyInfo | undefined;

  /** The immediate broader term (Class.broader), or undefined at a root. */
  readonly broader: TermInfo | undefined;
  /** Immediate narrower terms (reverse of broader). */
  narrower(): TermInfo[];

  /** True if this term fixes a value for field `f` (a Fixed row exists). */
  fixes(f: FieldInfo): boolean;
  /** The value this term pins for `f`, or undefined if it does not fix it. */
  getFixedValue(f: FieldInfo): Scalar | undefined;
}
```

### 3.7 `TaxonomyInfo`

A bounded vocabulary — a row in the `Taxonomy` table.

```ts
export class TaxonomyInfo {
  readonly name: string;
  readonly token: Token;
  /** The concept(s) this taxonomy represents (Taxonomy.represents slice). */
  represents(): TypeInfo[];
  /** Root terms (terms with no broader within this taxonomy). */
  roots(): TermInfo[];
  /** Every term in this taxonomy. */
  getTerms(): TermInfo[];
}
```

### 3.8 `AnnotationInfo`

An applied annotation — the `CustomAttributeData` analog.

```ts
export class AnnotationInfo {
  /** The annotation type (a TypeInfo whose kind is MetaKind.Annotation). */
  readonly type: TypeInfo;
  /** The applied argument values, keyed by annotation field name. */
  readonly args: ReadonlyMap<string, Scalar>;
}
```

### 3.9 `InstanceMirror` + `FieldView` — the payoff

The single object that answers **both provenance axes at the point of use**.

```ts
export class InstanceMirror {
  /** The reflected data-graph node. */
  readonly node: Node;
  /** The node's concept (node.type → TypeInfo). */
  readonly type: TypeInfo;
  /** The node's class/term (node.class → TermInfo), or undefined. */
  readonly class: TermInfo | undefined;

  /** One FieldView per effective field of `type`. */
  fields(): FieldView[];
  /** The FieldView for one field by name, or undefined. */
  field(name: string): FieldView | undefined;
}

export class FieldView {
  /** The effective FieldInfo (carries Axis-1 declaringType). */
  readonly field: FieldInfo;
  /** The effective value on this instance (== field.getValue(node)). */
  readonly value: Scalar | undefined;

  /** AXIS 1 — where the field was DEFINED. Identity: field.declaringType. */
  readonly definitionOrigin: TypeInfo;
  /** AXIS 2 — where the VALUE came from: the term that fixes it, or "self". */
  readonly valueOrigin: TermInfo | "self";
}
```

- `definitionOrigin` is *definitionally* `field.declaringType` — the two-axis
  design means Axis 1 needs no extra computation, it is already carried by the
  member handle.
- `valueOrigin` is computed by §4.3.

## 4. Resolution semantics (against SPEC-04 tables)

All resolution is **pure integer table walking** — no name strings beyond the
final surface accessors; comparisons are on `#Strings` indices and `#Const`
blobs. SPEC-04 tables referenced: `TypeInfo{ extends, fieldStart, fieldCount,
relStart, relCount }`, `Field{ name, type, card }`, `Rel{ name, targetStart,
targetCount, card, inverse }`, `Target{ type }`, `Class{ name, type, taxonomy,
broader, fixedStart, fixedCount }`, `Fixed{ field, value }`, `Taxonomy{
representsStart, representsCount }`.

### 4.1 `getDeclaredFields` / `getFields` / `declaringType`

- **Declared** — for TypeInfo row *t*, scan the half-open slice
  `[t.fieldStart, t.fieldStart + t.fieldCount)` of the `Field` table. Each row
  becomes a `FieldInfo` whose `declaringType = t` and `reflectedType = t`.
  Relationships are the same over `[relStart, relStart+relCount)` of `Rel`.
- **Effective** — walk the `extends` chain `[t, t.baseType, …, Element]`. For
  each ancestor, take its declared members; accumulate into a name-keyed map
  **only if the name is not already present** (subtype declared first ⇒ subtype
  wins ⇒ override→nearest declarer wins). Each surfaced member keeps
  `declaringType` = the ancestor that actually declared it (Axis 1), while
  `reflectedType` = *t* (the receiver). Order: the map's insertion order —
  subtype-declared members before inherited ones.
- Because `declaringType` is captured when the row is read from an ancestor's
  slice, **Axis 1 is resolved for free**: no separate `typeOriginOf(type,
  field)` call is needed — the value the old `model.ts` computed by re-walking is
  now a field on the handle.

### 4.2 `isSubtypeOf` / `isAssignableFrom` / `getSupertypes`

`getSupertypes()` = follow `TypeInfo.extends` (coded index) until it is `0`
(Element's parent). `isSubtypeOf(other)` = `other.token` appears in
`this.getSupertypes()` tokens (strict). `isAssignableFrom(other)` =
`other.token === this.token || other.isSubtypeOf(this)`.

### 4.3 `valueOrigin` (Axis 2)

For a `FieldView` over node *n* and field *f* (`FieldInfo`):

1. Let `C = n.class` (a `Class`-table row via the node's `class` token). If the
   node has no class → `valueOrigin = "self"`.
2. Walk `C` and its `broader` chain. For the first term in the chain that has a
   `Fixed` row for `f` (scan `[fixedStart, fixedStart+fixedCount)` comparing
   `Fixed.field` token to `f.token`):
   - compare that term's `Fixed.value` (`#Const` blob) to the node's effective
     value `f.getValue(n)`.
   - if **equal** → `valueOrigin = TermInfo(thatTerm)` (the value came from the
     class/term).
   - if **not equal** (the instance overrode the fixed value) → `valueOrigin =
     "self"`.
3. If no term in the chain fixes `f` → `valueOrigin = "self"` (the value is the
   instance's own).

This is the idea-#9 rule `valueOriginOf(node, field)` made a handle method:
`classes[C].fixed[field] === node.attrs[field] ? C : "self"`, extended to walk
`broader` so an inherited fixed value is attributed to the term that actually
pinned it.

### 4.4 Laziness & identity

Every handle is `{ manifest, token }`. Accessors compute on demand from the
tables; no caching is required for correctness (a small per-manifest handle cache
keyed by token is an allowed optimisation, not a contract). Two handles are equal
iff `.token` is equal (within one manifest). All handles are frozen /
read-only; there are no setters.

## 5. Usage example — resolving both origins for a `Component` instance

```ts
// Model "shop": concept Element { name: string }
//               concept Component : Element { tier: string }
// taxonomy Layers represents Component; term Components.Surface : Component fixes tier = "ui".
// data node: { id: "shop.checkout", type: <Component>, class: <Components.Surface>,
//              attrs: { name: "Checkout" } }   // tier NOT overridden → inherits "ui"

const manifest = Manifest.load(bytes);
const node = domain.graph.getNode("shop.checkout")!;   // SPEC-06 supplies the node
const mirror = manifest.reflect(node);

mirror.type.fullName;            // "Component"
mirror.class?.id;                // "Components.Surface"

const name = mirror.field("name")!;
name.value;                      // "Checkout"
name.definitionOrigin.fullName;  // "Element"   ← Axis 1: declared on the base
name.valueOrigin;                // "self"       ← Axis 2: the instance set it

const tier = mirror.field("tier")!;
tier.value;                      // "ui"
tier.definitionOrigin.fullName;  // "Component" ← Axis 1: declared on Component
tier.valueOrigin;                // TermInfo(Components.Surface)
                                 //              ← Axis 2: value came from the term

// Equivalent lower-level reads:
manifest.getType("Component")!.getField("tier")!.declaringType.fullName; // "Component"
manifest.getType("Component")!.getFields().map(f => f.name);             // ["tier","name"]
manifest.getType("Component")!.isSubtypeOf(manifest.root());             // true
```

## 6. Relationship to existing `src/model/model.ts`

This API **supersedes the reflection-ish read methods** currently on
`Repository`, moving them off the live edge-walking graph onto the flattened
manifest tables. Mapping:

| Existing `Repository` method | Reflection API replacement | Change |
|------------------------------|----------------------------|--------|
| `schemaOf(concept)` | `TypeInfo.getDeclaredFields()` + `getDeclaredRelationships()` + `baseType` | edge-walk (`HasField`/`HasRelationship`/`Targets`) → table-slice read |
| `effectiveSchema(concept)` | `TypeInfo.getFields()` / `getRelationships()` | `supertypesOf`-merge → single `extends`-chain slice walk; **now carries `declaringType` per member** (Axis 1) which `effectiveSchema` dropped |
| `supertypesOf(concept)` | `TypeInfo.getSupertypes()` | `EdgeKind.Extends` closure → `extends` token chain |
| `subtypesOf(concept)` | *(reverse index; see Open Q)* | not a direct handle method — reverse of `isSubtypeOf` |
| `narrowerOf` / `broaderOf` | `TermInfo.narrower()` / `TermInfo.broader` | `EdgeKind.Narrower` edges → `Class.broader` column |
| `classOf(leaf)` | `InstanceMirror.class` | `EdgeKind.InstanceOf` edge → `node.class` token |
| `effectiveFields(leaf)` | `InstanceMirror.fields()` → `FieldView.value` | attrs+class overlay w/ marker blocklist → `getValue` + `Fixed` walk; **no blocklist** (markers moved to node root per SPEC-01) |
| `represents(taxonomy)` | `TaxonomyInfo.represents()` | `EdgeKind.Represents` → `Taxonomy.represents` slice |
| `termsOf(taxonomy)` | `TaxonomyInfo.getTerms()` | `EdgeKind.Contains` → `Class.taxonomy` back-index |

It **wraps rather than replaces** the *value* side: `FieldInfo.getValue(node)` /
`RelationshipInfo.getTargets(node)` still read the data-graph `Node`
(attrs/edges) — reflection supplies the *schema*, the node supplies the *data*.
`Repository.entity()` / `EntityBase` (the read lens in `src/model/entity.ts`)
and `toElement` (`src/model/element.ts`) are a *convenience projection* layer;
they can be re-based onto this API (its `schema()` → `TypeInfo`, its `fields`
marker-filtering → gone once markers live at the node root), but that migration
is downstream (implementation-order step 5, SPEC-01/02).

Not superseded (stay on `Repository`/`Graph`): mutation (`builder`), reactivity
(`view`/`changed`), derivations, invariant *evaluation*, validation, spans.
Reflection is read-only metadata; it does not run predicates.

## 7. Testing strategy

Tests live in `src/manifest/reflection/tests/` (per the repo `tests/`-subfolder
rule). Drive them off a small hand-authored manifest fixture (the §5 "shop"
model) built as SPEC-04 JSON, plus a couple of loaded-from-binary cases to prove
`Manifest.load` parity.

1. **Handle identity & laziness** — same token → equal handles; accessors are
   pure table lookups (no mutation observable; loading does not eagerly build
   every handle — assert via a counting/stub reader if practical).
2. **Axis 1 — `declaringType`** — `getFields()` on `Component` returns `tier`
   with `declaringType = Component` and `name` with `declaringType = Element`;
   `reflectedType = Component` for both. Override case: a subtype re-declaring
   `name` wins (nearest declarer), inherited copy is not surfaced.
3. **`getDeclaredFields` vs `getFields`** — declared excludes inherited; effective
   includes and dedups by name with subtype-wins order.
4. **Subtype algebra** — `isSubtypeOf`/`isAssignableFrom` reflexivity/strictness;
   `getSupertypes()` ends at `Element`; `Element.baseType === undefined`.
5. **Axis 2 — `valueOrigin`** — inherited fixed value → `TermInfo`; instance
   override → `"self"`; field the term doesn't fix → `"self"`; node with no class
   → all `"self"`. Broader-chain: value pinned by an ancestor term is attributed
   to that ancestor.
6. **Terms/taxonomies** — `getTerm`, `TaxonomyInfo.roots()/getTerms()`,
   `TermInfo.broader/narrower()`, `fixes`/`getFixedValue`.
7. **Relationships** — `getTargets(node)` resolves edges; `inverse` read;
   `targets` list from the `Target` slice.
8. **Annotations** — `getAnnotations()` on type and member; `AnnotationInfo.args`.
9. **`reflect` end-to-end** — the §5 example asserted verbatim (both axes).
10. **Parity vs `Repository`** — for a manifest emitted from a `Repository`
    fixture, `TypeInfo.getFields()` names/types == `Repository.effectiveSchema`
    fields; `InstanceMirror.field(f).value` == `Repository.attr(leaf, f)`. Guards
    the supersede claim.

## 8. Open questions

- **`subtypesOf` (reverse of `extends`)** — `isSubtypeOf` answers the forward
  question; enumerating *all* subtypes needs a reverse index. Provide it as a
  `Manifest.subtypesOf(t)` scan (or a built reverse map), or push to `Domain`
  (cross-manifest subtypes)? Deferred; not a per-handle method.
- **`resolveToken` return union** — a discriminated result vs. the wide union
  typed above. Prefer a `kind`-tagged result once SPEC-04's token-tag scheme is
  fixed.
- **Cross-manifest `baseType`** — the `TypeRef`/`Domain` back-link hop is SPEC-06;
  this spec assumes `baseType` *may* return a `TypeInfo` owned by another
  manifest. Confirm the handle carries its owning `Manifest` (it must) so
  `getFields()` across a dependency boundary reads the right tables.
- **Invariants shape** — `getInvariants(): string[]` (opaque blobs) per the
  JOURNAL open question; revisit if SPEC-03/04 gives invariants structure.
- **Annotation defs vs applications** — `AnnotationInfo` models an *application*;
  the *definition* is a `TypeInfo` with `kind === Annotation`. Confirm the
  SPEC-04 application-table split so `getAnnotations()` reads the right rows.
- **`Cardinality` enum member name** — RESOLVED (2026-09-16). `Cardinality` is
  now unified on the manifest's enum `{ One, Optional, Many, OneOrMore }`
  (`src/manifest/enums.ts`, the single canonical owner); `src/model/graph.ts`
  re-exports it. The former `NonEmpty` member is gone. This spec's references
  resolve directly.

## 9. Implementation tasks (bite-sized, TDD)

Each task = a failing test first, then the accessor. Assumes SPEC-04 tables/heaps
and a JSON reader exist (implementation-order step 1).

1. **Fixture** — hand-author the §5 "shop" manifest as SPEC-04 JSON; a test
   helper `loadShop(): Manifest`.
2. **`Manifest` skeleton** — `load` (JSON path), `model`, `version`, `root()`,
   `types()`, `getType()`. Test: names resolve, `root().name === "Element"`.
3. **`TypeInfo` core** — `name/namespace/fullName/kind/token`, `baseType`. Test:
   `Component.baseType === Element`, `Element.baseType === undefined`.
4. **`FieldInfo` + `getDeclaredFields`** — slice read; `declaringType`,
   `reflectedType`, `fieldType`, `cardinality`. Test: declared-only counts.
5. **`getFields` effective** — extends-chain merge, subtype-wins, `declaringType`
   preserved (Axis 1). Test: `Component.getFields()` field origins.
6. **`getField` + subtype algebra** — `isSubtypeOf`, `isAssignableFrom`,
   `getSupertypes`. Test: reflexivity/strictness matrix.
7. **`RelationshipInfo` + `getDeclaredRelationships`/`getRelationships`** —
   `targets`, `inverse`, `cardinality`, `getMembers`. Test on a fixture rel.
8. **`FieldInfo.getValue` / `RelationshipInfo.getTargets`** — read against a data
   `Node`. Test: attrs value; class-fixed fallback; edge targets.
9. **`TermInfo` + `TaxonomyInfo`** — `Class`/`Taxonomy`/`Fixed` reads;
   `broader`/`narrower`, `fixes`/`getFixedValue`, `roots`/`getTerms`/`represents`.
10. **`AnnotationInfo`** — `getAnnotations()` on type + member.
11. **`InstanceMirror` + `FieldView`** — `reflect(node)`, `fields()`, `field()`,
    `definitionOrigin` (Axis 1), `valueOrigin` (Axis 2, incl. broader walk +
    override→"self"). Test: the §5 example verbatim.
12. **`resolveToken`** — round-trip every handle's `.token` back to itself.
13. **Binary parity** — `Manifest.load(bytes)` from the SPEC-04 binary of the
    same fixture yields identical reflection results (piggybacks SPEC-04
    round-trip).
14. **`Repository` parity** — the §7.10 cross-check against `effectiveSchema` /
    `attr`.
```
