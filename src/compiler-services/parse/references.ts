/**
 * The single reference walk (design: unified-reference-resolver). One traversal
 * of the AST that yields EVERY symbol reference — with its role, span, and a
 * rewrite hook that mutates the underlying AST field. The loader consumes it to
 * build resolution sites (and rewrite qualified `ns.x` to flat ids); the
 * language-service reference-index consumes it for find-references / hover /
 * go-to-definition. Having one walk means the two can never drift on "what is a
 * reference." `collectDefinitions` is the companion walk for the definitions a
 * declaration introduces (its own node ids).
 *
 * ─────────────────────────── What a "reference" is ─────────────────────────────
 * A reference is any spot in the source where an author writes the NAME of some
 * other node: the parent in `extends`, the type of a field, the target of a
 * relationship, the concept a record is an instance of, a bare term used as a
 * value, an annotation name, and so on. Each such spot is emitted as one
 * {@link ReferenceVisit}. The `role` ({@link RefRole}) records WHICH kind of spot
 * it is, so consumers can treat, say, an `extends` parent differently from a
 * value reference without re-parsing the surrounding syntax.
 *
 * ───────────────────────── The rewrite-callback pattern ────────────────────────
 * Every reference carries a `rewrite(flat)` closure that writes a new (flat) id
 * back into the exact AST slot the reference came from. This is the whole point of
 * the unified walk: the loader's resolver pre-pass (loader.ts, "RESOLVE" section)
 * calls `visitReferences` once, and when a name resolves to a different flat id —
 * a qualified `ns.x` collapses to `x`, or a bare taxonomy term drops to its
 * `taxonomy.term` sibling — it calls `rewrite` to mutate the AST IN PLACE. Later
 * passes (Pass 1 onward) then read the already-flattened id and never see the
 * original qualified/bare form. Because the closure captures the specific field,
 * array element, or object property, the caller rewrites without knowing anything
 * about the node's shape.
 *
 * ─────────────────────── Scope for bare-term resolution ────────────────────────
 * Some references live inside a taxonomy term body (or a model body), where a bare
 * name like `technology` may be shorthand for a SIBLING term of the same taxonomy
 * or a term of a `uses`d taxonomy. Those references carry a `scope` ({ taxonomy,
 * uses }) so the resolver can try sibling / cross-taxonomy candidates before
 * declaring the name undefined. See loader.ts's term-scope resolution.
 *
 * `uses` targets are handled by the loader's own uses-normalization pass (they
 * must be flattened before term-body scope resolution), and namespace `import`
 * paths are not symbol references — neither is emitted here.
 */
import {
  DeclKind, ValueKind,
  type Declaration, type InstanceDecl, type Term, type ValueNode, type AnnotationApplication,
  type EdgeApplication,
} from "./ast.js";
import type { SourceSpan } from "../diagnostics/span.js";
import { PACKAGE_NODE_ID } from "../model/kinds.js";

/**
 * Which syntactic spot a reference occupies. The role lets a consumer react to a
 * reference by its meaning (an `extends` parent vs a value reference) without
 * re-inspecting the surrounding AST. It is NOT used to gate resolution — every
 * role resolves through the same name→node law — but it drives diagnostics,
 * hovers, and validation downstream.
 */
export enum RefRole
{
  Extends,               // the parent named in a concept's `extends`
  FieldType,             // the declared type of a `x : T` field
  RelationshipTarget,    // a target named in a `r -> T` relationship
  Represents,            // a concept a taxonomy `represents`
  Frames,                // a concept a viewpoint `frames`
  RecordConcept,         // the concept of a record / inline object / operator target
  InstanceOf,            // the class named in `instanceof`
  RefValue,              // a name written as a value (assignment RHS, edge endpoint)
  AnnotationName,        // the annotation named in `@Ann`
  ParamType,             // the declared type of an annotation parameter
}

/** One emitted reference: everything a consumer needs to resolve the name and,
 * once resolved, write the flat id back. This is the loader's {@link RefSite}
 * source of truth (loader.ts copies these fields into a RefSite). */
export interface ReferenceVisit
{
  /** The reference as written — bare or qualified (`ns.x`). */
  name: string;
  span: SourceSpan | undefined;
  role: RefRole;
  /** The declaring node id (for diagnostics), or null. */
  ownerNode: string | null;
  /** The member name this reference sits on (field / assignment), or null. */
  memberPath: string | null;
  /** Rewrite the underlying AST field to a flat id (qualified → flat, or bare
   * term → taxonomy-qualified sibling). The closure captures the exact AST slot
   * — a field, an array element, or an object property — so the caller mutates it
   * without knowing the node's shape. */
  rewrite: (flat: string) => void;
  /** Set for a reference inside a taxonomy term body: the enclosing taxonomy +
   * its `uses` list, for sibling / cross-taxonomy bare resolution. */
  scope?: { taxonomy: string; uses: readonly string[] };
}

/** Transparent file-wrapper "concepts" that are not real concept references. A
 * `technology-library { … }` block groups records in a file but is not itself an
 * EA concept, so its "concept" name must NOT be emitted as a reference to resolve
 * (it would report undefined). Mirrors the same set in loader.ts. */
const WRAPPER_CONCEPTS: ReadonlySet<string> = new Set(["technology-library"]);

/** The callback `visitReferences` invokes once per reference it finds. */
export type Visit = (v: ReferenceVisit) => void;

// ══════════════════════════════════════════════════════════════════════════════
//  visitReferences — the unified reference walk
//  One switch over the declaration kinds. Each arm emits every reference that kind
//  of declaration can hold, each with its role + a rewrite closure targeting the
//  exact AST slot. Value bodies recurse through visitValueRefs / visitInstanceRefs
//  / visitEdgeRefs below.
// ══════════════════════════════════════════════════════════════════════════════

/** Yield every symbol reference in `decl`. */
export function visitReferences(decl: Declaration, visit: Visit): void
{
  // Emit each annotation-application name on `node`. The owner id is the
  // application node (`<node>@<name>`), and the rewrite closure reassigns the
  // application's `name` field so a qualified annotation name flattens in place.
  const annotationRefs = (apps: readonly AnnotationApplication[], node: string): void => {
    for (const app of apps)
    {
      visit({ name: app.name, span: app.nameSpan ?? app.span, role: RefRole.AnnotationName,
        ownerNode: `${node}@${app.name}`, memberPath: null, rewrite: (r) => { app.name = r; } });
    }
  };
  switch (decl.kind)
  {
    case DeclKind.Taxonomy:
    {
      // Each concept the taxonomy `represents`; rewrite by index (represents is a
      // parallel array with representsSpans).
      decl.represents.forEach((c, i) => visit({
        name: c, span: decl.representsSpans?.[i] ?? decl.span, role: RefRole.Represents,
        ownerNode: decl.name, memberPath: null, rewrite: (r) => { decl.represents[i] = r; },
      }));
      annotationRefs(decl.annotations, decl.name);
      // Every value reference inside a term body inherits this scope: bare names may
      // resolve to a sibling term of THIS taxonomy or a term of a `uses`d taxonomy.
      // decl.uses is the same array the loader normalizes qualified→flat in place, so
      // this scope always sees the flattened list by resolution time.
      const scope = { taxonomy: decl.name, uses: decl.uses };
      // Walk the term hierarchy, emitting value refs in each term's assignments. A
      // term's id is namespaced as `<taxonomy>.<term>` for diagnostics.
      const walkTerm = (t: Term): void => {
        for (const a of t.assignments) visitValueRefs(a.value, `${decl.name}.${t.id}`, a.name, a.span, scope, visit);
        t.children.forEach(walkTerm);
      };
      decl.terms.forEach(walkTerm);
      break;
    }
    case DeclKind.Viewpoint:
    {
      // Each concept the viewpoint `frames`; rewrite by index (parallel to framesSpans).
      decl.frames.forEach((c, i) => visit({
        name: c, span: decl.framesSpans?.[i] ?? decl.span, role: RefRole.Frames,
        ownerNode: decl.name, memberPath: null, rewrite: (r) => { decl.frames[i] = r; },
      }));
      break;
    }
    case DeclKind.Concept:
    {
      // The `extends` parent, if any. Cast is needed because `extends` is a
      // readonly field on the AST node; the rewrite is the one sanctioned mutation.
      if (decl.extends !== null)
      {
        visit({ name: decl.extends, span: decl.extendsSpan ?? decl.span, role: RefRole.Extends,
          ownerNode: decl.name, memberPath: null, rewrite: (r) => { (decl as { extends: string | null }).extends = r; } });
      }
      // Each field's declared type. memberPath carries the field name so a
      // reference.undefined can point at the offending member.
      for (const f of decl.fields)
      {
        visit({ name: f.type, span: f.typeSpan ?? decl.span, role: RefRole.FieldType,
          ownerNode: decl.name, memberPath: f.name, rewrite: (r) => { f.type = r; } });
      }
      for (const rel of decl.relationships)
      {
        // A relationship may name several targets; rewrite each by index.
        rel.targets.forEach((target, i) => visit({
          name: target, span: rel.targetSpans?.[i] ?? decl.span, role: RefRole.RelationshipTarget,
          ownerNode: decl.name, memberPath: rel.name, rewrite: (r) => { rel.targets[i] = r; },
        }));
        // Annotations on the member resolve like any annotation name (undeclared →
        // reference.undefined; qualified → rewritten flat), keyed to the member node.
        annotationRefs(rel.annotations, `${decl.name}.${rel.name}`);
      }
      annotationRefs(decl.annotations, decl.name);
      break;
    }
    case DeclKind.Annotation:
      // Annotation parameters are typed like fields; only their types are references.
      for (const p of decl.params)
      {
        visit({ name: p.type, span: p.typeSpan ?? decl.span, role: RefRole.ParamType,
          ownerNode: decl.name, memberPath: p.name, rewrite: (r) => { p.type = r; } });
      }
      break;
    case DeclKind.Instance:
      // A top-level (class) instance: concept, instanceof, and all value bodies.
      // No model scope here — top-level instances are not inside a model's `uses`.
      visitInstanceRefs(decl, visit);
      break;
    case DeclKind.Model:
    {
      // A model's `uses` list is a term-drop scope for its instance value refs
      // (the model analogue of a taxonomy body's `uses`): a bare `azure-openai`
      // drops to the flat `stack.azure-openai` term. There is no enclosing
      // taxonomy, so the sibling slot is empty. `decl.libraries` is the same
      // array the loader normalizes qualified→flat in place before resolution.
      const scope = { taxonomy: "", uses: decl.libraries };
      // Every contained instance and body edge inherits the model's term-drop scope.
      for (const inst of decl.instances) visitInstanceRefs(inst, visit, scope);
      for (const edge of decl.edges) visitEdgeRefs(edge, visit, scope);
      break;
    }
    case DeclKind.Package:
      // A package block carries only annotation applications; they decorate the one
      // shared package node (PACKAGE_NODE_ID), not any per-package symbol.
      annotationRefs(decl.annotations, PACKAGE_NODE_ID);
      break;
    case DeclKind.Operator:
      // The target concept resolves like a record concept (qualified → flat,
      // undefined → reference.undefined). Endpoint member names are validated
      // against the concept schema by the loader, not here.
      visit({ name: decl.concept, span: decl.conceptSpan ?? decl.span, role: RefRole.RecordConcept,
        ownerNode: decl.glyph, memberPath: null, rewrite: (r) => { (decl as { concept: string }).concept = r; } });
      break;
    case DeclKind.Primitive:
      // A primitive is a leaf type with no members and no references.
      break;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  Body walkers — recursive helpers for value / instance / edge subtrees
//  These carry the optional term-drop `scope` down through nested records so a bare
//  name anywhere in a model or taxonomy body can be sibling/uses-resolved. Each
//  spreads `...(scope ? { scope } : {})` so a reference that has no scope simply
//  omits the field (the resolver treats "no scope" as "no bare-term fallback").
// ══════════════════════════════════════════════════════════════════════════════

/** Yield the endpoint references of an edge application (`a <glyph> b`). The
 * glyph itself is resolved against the operator table by the loader
 * (operator.undefined), not through symbol resolution. */
function visitEdgeRefs(
  edge: EdgeApplication,
  visit: Visit,
  scope?: { taxonomy: string; uses: readonly string[] },
): void
{
  // Both endpoints are ordinary value references (RefValue): each may be bare and
  // may term-drop. The owner id is the left endpoint (an edge has no id of its own).
  visit({ name: edge.left, span: edge.leftSpan ?? edge.span, role: RefRole.RefValue,
    ownerNode: edge.left, memberPath: null, rewrite: (r) => { (edge as { left: string }).left = r; },
    ...(scope ? { scope } : {}) });
  visit({ name: edge.right, span: edge.rightSpan ?? edge.span, role: RefRole.RefValue,
    ownerNode: edge.left, memberPath: null, rewrite: (r) => { (edge as { right: string }).right = r; },
    ...(scope ? { scope } : {}) });
}

/** Yield every reference held by an instance/record: its concept, its `instanceof`
 * class, and every value in its assignments, nested records, and body edges. */
function visitInstanceRefs(
  decl: InstanceDecl,
  visit: Visit,
  scope?: { taxonomy: string; uses: readonly string[] },
): void
{
  // Concept and `instanceof` are constructor references — resolved by namespace
  // reachability, never term-dropped — so they carry no scope. Only value
  // assignments (and nested records) inherit the model's term-drop scope.
  if (!WRAPPER_CONCEPTS.has(decl.concept))
  {
    visit({ name: decl.concept, span: decl.conceptSpan ?? decl.span, role: RefRole.RecordConcept,
      ownerNode: decl.id, memberPath: null, rewrite: (r) => { (decl as { concept: string }).concept = r; } });
  }
  if (decl.instanceOf !== null)
  {
    visit({ name: decl.instanceOf, span: decl.instanceOfSpan ?? decl.span, role: RefRole.InstanceOf,
      ownerNode: decl.id, memberPath: null, rewrite: (r) => { (decl as { instanceOf: string | null }).instanceOf = r; } });
  }
  for (const a of decl.assignments) visitValueRefs(a.value, decl.id, a.name, a.span, scope, visit);
  for (const child of decl.children) visitInstanceRefs(child, visit, scope);
  for (const edge of decl.edges) visitEdgeRefs(edge, visit, scope);
}

/** Yield the references inside one authored value (the RHS of `member = value`).
 * Recurses through lists, inline objects, and edge values. Note this walk does NOT
 * decide attr-vs-edge (a scalar String is simply not a reference and emits nothing);
 * that type-directed decision belongs to the loader once schemas are committed. */
function visitValueRefs(
  value: ValueNode,
  ownerNode: string,
  memberName: string,
  memberSpan: SourceSpan | undefined,
  scope: { taxonomy: string; uses: readonly string[] } | undefined,
  visit: Visit,
): void
{
  switch (value.kind)
  {
    case ValueKind.Name:
      // A bare name value — the archetypal RefValue; may term-drop via `scope`.
      visit({ name: value.name, span: value.span ?? memberSpan, role: RefRole.RefValue,
        ownerNode, memberPath: memberName, rewrite: (r) => { (value as { name: string }).name = r; },
        ...(scope ? { scope } : {}) });
      break;
    case ValueKind.List:
      // A repeated member: recurse per item, keeping the same member name + scope.
      for (const item of value.items) visitValueRefs(item, ownerNode, memberName, memberSpan, scope, visit);
      break;
    case ValueKind.Object:
      // An inline object's concept + nested refs must resolve (and qualified
      // names rewrite flat) like any record. It has no id at parse time, so
      // nested refs borrow the outer ownerNode for diagnostics.
      visit({ name: value.concept, span: value.conceptSpan ?? memberSpan, role: RefRole.RecordConcept,
        ownerNode, memberPath: memberName, rewrite: (r) => { (value as { concept: string }).concept = r; } });
      // `id` is the object's own identity, not a reference — skip it.
      for (const a of value.assignments) if (a.name !== "id") visitValueRefs(a.value, ownerNode, a.name, a.span, scope, visit);
      for (const child of value.children) visitInstanceRefs(child, visit, scope);
      for (const edge of value.edges) visitEdgeRefs(edge, visit, scope);
      break;
    case ValueKind.Edge:
      // An operator application used as a value: operands resolve like any value
      // reference; the glyph is resolved against the operator table by the loader.
      // Body value refs resolve too (skip the object's own `id`).
      visitEdgeRefs(value.edge, visit, scope);
      for (const a of value.edge.body) if (a.name !== "id") visitValueRefs(a.value, ownerNode, a.name, a.span, scope, visit);
      break;
    case ValueKind.String:
    case ValueKind.Composite:
    case ValueKind.Boolean:
      // Literal scalars and `|`-composites hold no symbol reference to resolve.
      break;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  collectDefinitions — the companion "what does this declaration introduce?" walk
//  Where visitReferences finds USES of names, this finds DEFINITIONS: the node ids a
//  declaration brings into existence. The loader runs it over every unit up front so
//  the resolver knows what exists locally (see loader.ts, "defined"/"sourceNs"), and
//  each id is stamped with its home `ns` so namespace visibility can be enforced.
// ══════════════════════════════════════════════════════════════════════════════

/** Record every node id a declaration DEFINES (its own name + nested term /
 * child ids), stamping each with its home namespace. Companion to
 * {@link visitReferences}. */
export function collectDefinitions(
  decl: Declaration,
  ns: string,
  defined: Set<string>,
  sourceNs: Map<string, string>,
): void
{
  // Register one id: mark it defined AND remember which namespace declared it.
  const define = (id: string): void => { defined.add(id); sourceNs.set(id, ns); };
  switch (decl.kind)
  {
    case DeclKind.Primitive:
    case DeclKind.Concept:
    case DeclKind.Annotation:
      // A single named type: it defines just its own name.
      define(decl.name);
      break;
    case DeclKind.Taxonomy:
    {
      // The taxonomy node, plus every term as a flat `<taxonomy>.<term>` id (this is
      // the flat form bare-term references rewrite to during resolution).
      define(decl.name);
      const add = (t: Term): void => { define(`${decl.name}.${t.id}`); t.children.forEach(add); };
      decl.terms.forEach(add);
      break;
    }
    case DeclKind.Viewpoint:
      define(decl.name);
      break;
    case DeclKind.Instance:
      // A top-level instance + all its nested records.
      defineInstance(decl, ns, defined, sourceNs);
      break;
    case DeclKind.Model:
      // The model container node, plus each contained instance subtree.
      define(decl.id);
      for (const inst of decl.instances) defineInstance(inst, ns, defined, sourceNs);
      break;
    case DeclKind.Package:
      // Package blocks define no named symbol (they only apply annotations to the
      // shared package node, which the loader creates once).
      break;
    case DeclKind.Operator:
      // An operator does NOT define a namespaced symbol — its glyph is resolved
      // via the operator table, not name resolution. Edge applications mint
      // their ids in the loader, so they define nothing here either.
      break;
  }
}

/** Define an instance's id and recurse into its nested records. Value-assigned
 * inline objects are NOT defined here — their ids are minted later by the loader. */
function defineInstance(decl: InstanceDecl, ns: string, defined: Set<string>, sourceNs: Map<string, string>): void
{
  defined.add(decl.id);
  sourceNs.set(decl.id, ns);
  for (const child of decl.children) defineInstance(child, ns, defined, sourceNs);
}
