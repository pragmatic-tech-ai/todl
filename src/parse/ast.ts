/**
 * Parse AST for the TODL surface (design spec §3) — the tree the PARSER produces
 * and the LOADER consumes. This is the parse-time shape of a `.todl` file: one
 * {@link NamespaceNode} per file, holding a flat list of top-level
 * {@link Declaration}s, each mirroring a chunk of surface syntax almost verbatim.
 *
 * ─────────────────────────────── Where it sits ─────────────────────────────────
 *   source text ──parser──▶  AST (this file)  ──loader──▶  Repository (typed graph)
 *
 * These interfaces are DUMB DATA: they capture *what was written*, not *what it
 * means*. Nothing here resolves references, classifies a value as attr-vs-edge, or
 * knows a concept's schema — all of that is the loader's job (see loader.ts). So,
 * for example, a value written as a bare identifier is just a {@link NameValue};
 * only the loader decides (from the member's declared type) whether it becomes a
 * scalar attr or a graph edge.
 *
 * ───────────────────────────────── Conventions ─────────────────────────────────
 *   • Every node is a plain interface tagged by a `kind` enum member
 *     ({@link DeclKind} for declarations, {@link ValueKind} for values), so the
 *     loader can `switch` on it exhaustively.
 *   • `span` (and the many optional `…Span` fields) carry source locations so
 *     downstream diagnostics and the language server can point back at the exact
 *     text. Optional `…Span?` fields are absent on synthesized nodes or older
 *     parses that predate span capture.
 *   • Parallel arrays: several decls keep a `fooSpans?` array positionally aligned
 *     with a `foo` array (e.g. `uses` / `usesSpans`), so span[i] belongs to foo[i].
 *
 * Cardinality reuses the model enum. Invariant predicates are captured as raw
 * token slices here; the predicate parser turns them into expression ASTs.
 */

import type { Token } from "./lexer.js";
import type { Cardinality } from "../model/graph.js";
import type { SourceSpan } from "../diagnostics/span.js";

// ═══════════════════════════════ DISCRIMINANT ENUMS ═══════════════════════════
// The two tag enums every node carries. `kind` on a declaration is one of
// DeclKind; `kind` on a value is one of ValueKind. Both let the loader switch
// exhaustively over the union types (Declaration / ValueNode) defined below.

/** The kind of a top-level declaration — one member per statement the language
 * supports at file scope (`primitive`, `taxonomy`, `concept`, `model`, …). */

export enum DeclKind
{
  Primitive,
  Taxonomy,
  Viewpoint,
  Concept,
  Instance,
  Model,
  Annotation,
  Package,
  Operator,
}

/** The kind of an authored VALUE (the right-hand side of `name = …`, an array
 * element, or an annotation param) — the surface shapes a value can take. */
export enum ValueKind
{
  String,
  Name,
  List,
  Composite,
  Boolean,
  Object,
  Edge,
}

// ══════════════════════════════════ VALUES ════════════════════════════════════
// The right-hand side of an assignment (`name = value`), a list item, or an
// annotation param value. Every value is one of these, united as ValueNode below.
// Reminder: the AST does NOT decide attr-vs-edge; the loader does, from the
// member's declared type — so a plain `NameValue` may end up as either.

/** A quoted string literal — `name = "text"`. */
export interface StringValue
{
  kind: ValueKind.String;
  text: string;
}

/** A boolean literal — the reserved words `true` / `false`. */
export interface BooleanValue
{
  kind: ValueKind.Boolean;
  value: boolean;
}

/** A bare identifier value — an enum member (`service`) or, when the member's
 * declared type is a concept/taxonomy, a reference. */
export interface NameValue
{
  kind: ValueKind.Name;
  name: string;
  /** Span of the name occurrence (set by the parser) — used for reference
   * resolution diagnostics and go-to-definition on reference values. */
  span?: SourceSpan;
}

/** A bracketed list value — `name = [a, b, c]` (a repeated member). Each item is
 * itself a value node; the loader realizes one attr/edge per item. */
export interface ListValue
{
  kind: ValueKind.List;
  items: ValueNode[];
}

/** A `|`-composed set of enum-flag members, e.g. `physical | on-premises`. */
export interface CompositeValue
{
  kind: ValueKind.Composite;
  parts: string[];
}

/** A typed inline object literal — `concept { … }` — assignable to a
 * concept/taxonomy-typed field. Materialised by the loader as a contained,
 * field-bound node with a minted (or `id =`-supplied) id. */
export interface ObjectValue
{
  kind: ValueKind.Object;
  concept: string;
  assignments: AssignmentNode[];
  children: InstanceDecl[];
  annotations: AnnotationApplication[];
  edges: EdgeApplication[];
  conceptSpan?: SourceSpan;
  span: SourceSpan;
}

/** An operator application used as a value — `a <glyph> b` on the RHS of `=` or
 * as an array element (design §2). Materialised by the loader as the minted
 * reified entity, contained by the owner and bound to the field. */
export interface EdgeValue
{
  kind: ValueKind.Edge;
  edge: EdgeApplication;
}

/** The union of every value shape; discriminate on `.kind` (a {@link ValueKind}). */
export type ValueNode =
  | StringValue
  | NameValue
  | ListValue
  | CompositeValue
  | BooleanValue
  | ObjectValue
  | EdgeValue;

// ═══════════════════════════ EDGES & ASSIGNMENTS ══════════════════════════════

/** A `left <glyph> right [ { … } | ; ]` edge usage (design §3), e.g.
 * `frontend --> database { calls = "REST" }`. Shape-only: the loader resolves
 * `glyph` against the operator table and materializes the reified edge, with
 * `body` supplying the edge entity's own field assignments. */
export interface EdgeApplication
{
  glyph: string;
  left: string;
  right: string;
  leftSpan?: SourceSpan;
  rightSpan?: SourceSpan;
  glyphSpan?: SourceSpan;
  body: AssignmentNode[];
  span: SourceSpan;
}

/** One `name = value` assignment — the atom of every record/term/annotation body. */
export interface AssignmentNode
{
  name: string;
  value: ValueNode;
  /** Source span of `name = value` — set for authored assignments; absent for synthesized ones (edge-record from/to/operator). */
  span?: SourceSpan;
}

// ══════════════════════════════ DECLARATIONS ══════════════════════════════════
// The top-level statements of a file, united as Declaration below. Roughly two
// families: INSTANCE-side (concrete data — Instance, Model) and ONTOLOGY-side
// (types — Concept, Taxonomy, Viewpoint, Primitive, Annotation, Operator), plus
// the singleton Package. The loader stages them in dependency order across passes.

/** A record — a concrete object or a `class` (a partial, fixed-value definition),
 * e.g. `component api { … }` inside a model, or `class widget { … }`. Legal as a
 * concrete object only inside a `model { … }`; classes may live at file scope. */
export interface InstanceDecl
{
  kind: DeclKind.Instance;
  concept: string;
  id: string;
  /** Optional `: <meta-model>` binding on a container record (`model m : ea`). */
  binds: string | null;
  /** `true` when declared with the `class` modifier — a partial, fixed-value definition. */
  isClass: boolean;
  /** The class this leaf instantiates (`instanceof <class>`), or null. */
  instanceOf: string | null;
  assignments: AssignmentNode[];
  /** Nested records declared inside this instance's body (containment). */
  children: InstanceDecl[];
  /** `annotate` applications in this record's body. Staged only for classes;
   * on a concrete instance the loader reports `annotation.invalid-target`. */
  annotations: AnnotationApplication[];
  /** Edge applications (`a <glyph> b`) in this record's body. */
  edges: EdgeApplication[];
  span: SourceSpan;
  /** Span of the leading concept identifier (`<concept> <id>`). */
  conceptSpan?: SourceSpan;
  /** Span of the `instanceof <class>` class identifier, when present. */
  instanceOfSpan?: SourceSpan;
  /** Span of the record's id identifier. */
  idSpan?: SourceSpan;
}

/** A `model <id> : <meta-model> [uses …] [conforms …] { … }` container — the
 * instance-carrier that holds concrete objects and body-level edges. May be split
 * across several files under one id (each block then required to `conforms`). */
export interface ModelDecl
{
  kind: DeclKind.Model;
  id: string;
  /** The bound meta-model (`: <meta-model>`) — required. */
  metaModel: string;
  /** The `uses <lib>, …` library list; empty when omitted. */
  libraries: string[];
  /** The concrete objects this model carries. */
  instances: InstanceDecl[];
  /** Edge applications (`a <glyph> b`) in the model body. */
  edges: EdgeApplication[];
  /** The viewpoint this model conforms to (`… conforms <viewpoint>`), or null. */
  conforms: string | null;
  span: SourceSpan;
  idSpan?: SourceSpan;
  metaModelSpan?: SourceSpan;
  /** Span of each `uses` library identifier, parallel to `libraries`. */
  librarySpans?: SourceSpan[];
  /** Span of the `conforms` viewpoint identifier, when present. */
  conformsSpan?: SourceSpan;
}

/** A USE of an annotation — `target@Ann(param = v)` (or `annotate @Ann` in a
 * body). Decorates concepts, members, taxonomies/terms, classes, or the package.
 * The declaration of the annotation itself is {@link AnnotationDecl}. */
export interface AnnotationApplication
{
  /** The annotation being applied. */
  name: string;
  /** Fixed `param = value` param assignments. */
  assignments: AssignmentNode[];
  span: SourceSpan;
  nameSpan?: SourceSpan;
}

/** An `annotation <Name> [ : <Base> ] { <params> }` declaration — defines a
 * reusable type-level decorator with typed params. Applied via
 * {@link AnnotationApplication}. */
export interface AnnotationDecl
{
  kind: DeclKind.Annotation;
  name: string;
  /** The base annotation this one extends (`annotation Sub : Base`), or null. */
  extends: string | null;
  extendsSpan?: SourceSpan;
  /** Typed params, reusing FieldDecl (name / type / cardinality). */
  params: FieldDecl[];
  span: SourceSpan;
  nameSpan?: SourceSpan;
}

/** A `package { … }` block — carries annotation applications on the singleton
 * package node (per-package metadata). There is one shared package node across all
 * `package` blocks in a compile. */
export interface PackageDecl
{
  kind: DeclKind.Package;
  annotations: AnnotationApplication[];
  span: SourceSpan;
}

/** An `operator <glyph> : <concept> (<from>, <to>);` (reified edge) or
 * `operator <glyph> : <concept>.<relationship>;` (relationship member)
 * declaration — binds an infix glyph to edge materialization (design §1). */
export interface OperatorDecl
{
  kind: DeclKind.Operator;
  glyph: string;
  glyphSpan?: SourceSpan;
  concept: string;
  conceptSpan?: SourceSpan;
  /** Reified form: the two endpoint member names; null for the relationship form. */
  fromMember: string | null;
  toMember: string | null;
  /** Relationship form: the relationship member on `concept`; null for the reified form. */
  relationship: string | null;
  span: SourceSpan;
}

// ── Concept members (fields, relationships, invariants) ────────────────────────
// The building blocks of a ConceptDecl body. Also reused elsewhere: FieldDecl
// doubles as an annotation's typed param.

/** A `:` field member — `<name> : <type>` (with cardinality). Whether it becomes a
 * scalar attr or a reference edge depends on `type` (a primitive vs a
 * concept/taxonomy) — the loader decides. Also reused for annotation params. */
export interface FieldDecl
{
  name: string;
  type: string;
  cardinality: Cardinality;
  nameSpan?: SourceSpan;
  typeSpan?: SourceSpan;
}

/** A `->` relationship member — `<name> -> <T1>, <T2> …` (with cardinality). Always
 * reference-like: materialized as graph edges, never scalar attrs. May itself carry
 * member-level annotations. */
export interface RelationshipDecl
{
  name: string;
  targets: string[];
  cardinality: Cardinality;
  annotations: AnnotationApplication[];
  nameSpan?: SourceSpan;
  targetSpans?: SourceSpan[];
}

/** An `invariant "<description>" [ predicate = … ]` — a constraint on a concept.
 * The predicate is kept as raw lexer tokens here; the predicate parser turns it
 * into an expression AST at load time. Prose-only invariants have `predicate: null`. */
export interface InvariantDecl
{
  description: string;
  /** Raw tokens of the `predicate = …` expression, or `null` for prose-only invariants. */
  predicate: Token[] | null;
}

/** A `concept <Name> [ : <parent> ] { … }` declaration — a type in the ontology,
 * with fields, relationships, invariants, and annotations. A parent-less concept
 * implicitly extends the prelude root `element` (the loader adds that). */
export interface ConceptDecl
{
  kind: DeclKind.Concept;
  name: string;
  extends: string | null;
  description: string;
  fields: FieldDecl[];
  relationships: RelationshipDecl[];
  invariants: InvariantDecl[];
  annotations: AnnotationApplication[];
  span: SourceSpan;
  /** Span of the `extends` parent identifier (`: <parent>`), when present. */
  extendsSpan?: SourceSpan;
  /** Span of the concept's name identifier. */
  nameSpan?: SourceSpan;
}

// ── Taxonomy terms ─────────────────────────────────────────────────────────────

/** One term inside a taxonomy — e.g. `location azure { region = "..." }`. A term is
 * a CLASS of a represented concept, carrying that concept's fixed field values, and
 * may nest child terms (a hierarchy). Not a top-level Declaration; it only appears
 * inside a {@link TaxonomyDecl}. */
export interface Term
{
  id: string;
  /** The concept this term is a class of, from the leading keyword
   * (`location azure { }`). `null` for the bare `term` alias, valid only when
   * the taxonomy represents exactly one concept. */
  concept: string | null;
  /** The term's fixed field values — it is a class of its concept. */
  assignments: AssignmentNode[];
  children: Term[];
  /** `annotate` applications on this term (a term is a class of its concept). */
  annotations: AnnotationApplication[];
  span: SourceSpan;
  /** Span of the term's id identifier. */
  idSpan?: SourceSpan;
}

/** A `taxonomy <Name> : represents <C…> [uses …] { <terms> }` declaration — a
 * classification tree of {@link Term}s over one or more concepts. `uses` brings
 * sibling taxonomies' terms into bare scope for this one's term-body references. */
export interface TaxonomyDecl
{
  kind: DeclKind.Taxonomy;
  name: string;
  /** The concepts this taxonomy represents (`taxonomy X : represents C1, C2`). */
  represents: string[];
  /** Span of each `represents` target identifier, parallel to `represents`.
   * Absent when the parse predates span capture. */
  representsSpans?: SourceSpan[];
  description: string;
  terms: Term[];
  /** `annotate` applications on the taxonomy itself (decorate the taxonomy
   * node, e.g. a taxonomy-wide icon), distinct from its terms' annotations. */
  annotations: AnnotationApplication[];
  /** The `uses <tax>, …` list of other taxonomies whose terms are in bare
   * scope for this taxonomy's term-body references; empty when omitted. */
  uses: string[];
  /** Span of each `uses` target identifier, parallel to `uses`. */
  usesSpans?: SourceSpan[];
  span: SourceSpan;
  /** Span of the taxonomy's name identifier. */
  nameSpan?: SourceSpan;
}

/** A `viewpoint <Name> : frames <C…>` declaration — names a set of concepts that
 * form one "view" of a model; a {@link ModelDecl} may `conforms` to a viewpoint. */
export interface ViewpointDecl
{
  kind: DeclKind.Viewpoint;
  name: string;
  /** The concepts this viewpoint frames (`viewpoint X : frames C1, C2`). */
  frames: string[];
  /** Span of each `frames` target identifier, parallel to `frames`. */
  framesSpans?: SourceSpan[];
  span: SourceSpan;
  /** Span of the viewpoint's name identifier. */
  nameSpan?: SourceSpan;
}

/** A `primitive <name> [ : <base> ] [ /regex/ ]` declaration — a scalar value type
 * (the leaves of the type system, e.g. `string`, `int`). `base` refines another
 * primitive; `regex` optionally constrains its literal form. */
export interface PrimitiveDecl
{
  kind: DeclKind.Primitive;
  name: string;
  base: string | null;
  description: string;
  regex: string | null;
  span: SourceSpan;
  /** Span of the primitive's name identifier. */
  nameSpan?: SourceSpan;
}

/** The union of every top-level declaration; discriminate on `.kind` (a
 * {@link DeclKind}). This is what a {@link NamespaceNode} holds. */
export type Declaration =
  | ConceptDecl | TaxonomyDecl | ViewpointDecl | PrimitiveDecl | InstanceDecl | ModelDecl
  | AnnotationDecl | PackageDecl | OperatorDecl;

// ═══════════════════════════════ FILE ROOT ════════════════════════════════════

/** The root of a parsed file — one per `.todl` source. Carries the file's
 * `namespace <path>` (visibility), its `import <path>` list (what it can see), and
 * the flat list of top-level {@link Declaration}s. The loader flattens all files'
 * namespace nodes into per-declaration "units" tagged with ns + imports + uri. */
export interface NamespaceNode
{
  path: string;
  imports: string[];
  declarations: Declaration[];
  span: SourceSpan;
  /** Span of each `import <path>` path, parallel to `imports`. */
  importSpans?: SourceSpan[];
}
