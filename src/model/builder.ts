/**
 * The staging mutation API over a {@link Graph} (design spec §5, §R2).
 *
 * Edits are staged, then applied together on {@link Builder.commit}. Commit is
 * two-phase — all nodes first, then attrs and edges — so a reference may point
 * at a target staged later in the same batch (forward references). A pre-check
 * validates every staged reference before anything is written, so a bad
 * reference aborts the whole commit without partial mutation.
 *
 * Covers both tiers: instance-tier (`assertInstance` / `setField` /
 * `addRelationship`) and ontology-tier (`defineConcept` / `definePrimitive` /
 * `addField` / `addConceptRelationship`).
 */

import { Graph, EdgeKind, Tier, Cardinality, type Node, type NodeId, type Scalar, type FieldDecl } from "./graph.js";
import { MetaKind } from "./kinds.js";

/** A taxonomy term = a class of its concept: its fixed field values (an attr
 * map) plus zero-or-more nested child terms. `concept` names which of the
 * taxonomy's represented concepts the term is a class of; omit it for the
 * single-concept `term` alias (falls back to the sole represented concept). */
export interface TermInput {
  id: NodeId;
  concept?: NodeId;
  attrs?: ReadonlyMap<string, Scalar>;
  /** Domain relationship edges from the term (name -> target ids), e.g. a
   * location term's `parent` or a technology term's `available-in`. */
  relationships?: readonly { name: string; target: NodeId }[];
  children?: readonly TermInput[];
}

interface StagedAttr {
  id: NodeId;
  name: string;
  value: Scalar;
}

interface StagedEdge {
  kind: EdgeKind;
  via: NodeId | null;
  from: NodeId;
  to: NodeId;
}

interface StagedField {
  concept: NodeId;
  decl: FieldDecl;
}

export class Builder {
  private readonly stagedNodes: Node[] = [];
  private readonly stagedAttrs: StagedAttr[] = [];
  private readonly stagedEdges: StagedEdge[] = [];
  private readonly stagedFields: StagedField[] = [];
  private currentNamespace: string | null = null;

  constructor(private readonly graph: Graph) {}

  /** Stamp `ns` as the `namespace` provenance attr on every node staged after this call. */
  setNamespace(ns: string): this {
    this.currentNamespace = ns;
    return this;
  }

  // ── Instance tier ───────────────────────────────────────────────────────

  /** Stage a new instance node typed by `type`; `asClass` marks it a class. The
   *  flat node id is also its `localId` (record identity — was the `id` attr). */
  assertInstance(type: NodeId, id: NodeId, asClass = false): this {
    this.stagedNodes.push(this.makeNode(id, Tier.Instance, { type, isClass: asClass, localId: id }));
    return this;
  }

  /** Stage a model container node (Instance-tier, the Model language construct). */
  assertModel(id: NodeId): this {
    this.stagedNodes.push(this.makeNode(id, Tier.Instance, { metaKind: MetaKind.Model, localId: id }));
    return this;
  }

  /** Stage an annotation-type declaration node (Ontology-tier). */
  defineAnnotation(id: NodeId, extendsId: NodeId | null = null): this {
    this.stagedNodes.push(this.makeNode(id, Tier.Ontology, { metaKind: MetaKind.Annotation }));
    if (extendsId !== null) {
      this.stagedEdges.push({ kind: EdgeKind.Extends, via: null, from: id, to: extendsId });
    }
    return this;
  }

  /** Stage the singleton package node (Ontology-tier), host of package annotations. */
  definePackageNode(id: NodeId): this {
    this.stagedNodes.push(this.makeNode(id, Tier.Ontology, { metaKind: MetaKind.Package }));
    return this;
  }

  /** Stage an annotation application `<target>@<annotationId>` (Ontology-tier, typed by
   *  the annotation) plus the `Annotated` edge target -> application. Returns the app id. */
  annotate(target: NodeId, annotationId: NodeId): NodeId {
    const appId = `${target}@${annotationId}`;
    this.stagedNodes.push(this.makeNode(appId, Tier.Ontology, { type: annotationId }));
    this.stagedEdges.push({ kind: EdgeKind.Annotated, via: null, from: target, to: appId });
    return appId;
  }

  /** Stage a scalar field write on `id`. */
  setField(id: NodeId, name: string, value: Scalar): this {
    this.stagedAttrs.push({ id, name, value });
    return this;
  }

  /** Stage a domain relationship edge `from -[name]-> to`. */
  addRelationship(from: NodeId, name: NodeId, to: NodeId): this {
    this.stagedEdges.push({ kind: EdgeKind.Relationship, via: name, from, to });
    return this;
  }

  /** Stage a containment edge `parent -contains-> child`. */
  addContains(parent: NodeId, child: NodeId): this {
    this.stagedEdges.push({ kind: EdgeKind.Contains, via: null, from: parent, to: child });
    return this;
  }

  /** Stage a class-instantiation edge `leaf -instanceOf-> class`. */
  addInstanceOf(leaf: NodeId, cls: NodeId): this {
    this.stagedEdges.push({ kind: EdgeKind.InstanceOf, via: null, from: leaf, to: cls });
    return this;
  }

  // ── Ontology tier ───────────────────────────────────────────────────────

  /** Stage a primitive declaration node. */
  definePrimitive(id: NodeId): this {
    this.stagedNodes.push(this.makeNode(id, Tier.Ontology, { metaKind: MetaKind.Primitive }));
    return this;
  }

  /** Stage a concept declaration, optionally extending `extendsId`. */
  defineConcept(id: NodeId, extendsId: NodeId | null = null): this {
    this.stagedNodes.push(this.makeNode(id, Tier.Ontology, { metaKind: MetaKind.Concept }));
    if (extendsId !== null) {
      this.stagedEdges.push({ kind: EdgeKind.Extends, via: null, from: id, to: extendsId });
    }
    return this;
  }

  /** Stage a declared field on `concept`: a scalar/enum/ref-typed property. The
   *  field's schema is carried on the owner node (SPEC-01 #4) — no member node,
   *  no `HasField` edge; the value lands in an instance's `attrs` (scalar) or a
   *  relationship edge (reference) at the instance tier. */
  addField(concept: NodeId, name: string, type: NodeId, cardinality: Cardinality = Cardinality.One): this {
    this.stagedFields.push({ concept, decl: { name, type, cardinality } });
    return this;
  }

  /** Stage a relationship member on `concept`, targeting another concept. */
  addConceptRelationship(
    concept: NodeId,
    name: string,
    targets: NodeId[],
    cardinality: Cardinality = Cardinality.Many,
    inverse: string | null = null,
  ): this {
    const memberId = `${concept}.${name}`;
    const node = this.makeNode(memberId, Tier.Ontology, { metaKind: MetaKind.Relationship });
    node.attrs.set("name", name);
    node.attrs.set("cardinality", cardinality);
    if (inverse !== null) node.attrs.set("inverse", inverse);
    this.stagedNodes.push(node);
    this.stagedEdges.push({ kind: EdgeKind.HasRelationship, via: null, from: concept, to: memberId });
    for (const target of targets) {
      this.stagedEdges.push({ kind: EdgeKind.Targets, via: null, from: memberId, to: target });
    }
    return this;
  }

  /**
   * Stage a taxonomy: the taxonomy node (`typeOf = Taxonomy`) plus one
   * `Represents` edge per represented concept, plus one **Instance-tier class
   * node** per term (typed by the term's own concept — `term.concept`, or the
   * sole represented concept for the single-concept alias — marked `class`, id
   * `taxonomy.term`), a `Contains` membership edge taxonomy -> term, and a
   * `Narrower` edge from each parent term to each child term. Terms nest
   * arbitrarily.
   */
  defineTaxonomy(name: NodeId, represents: readonly NodeId[], terms: readonly TermInput[]): this {
    this.stagedNodes.push(this.makeNode(name, Tier.Ontology, { metaKind: MetaKind.Taxonomy }));
    for (const concept of represents) {
      this.stagedEdges.push({ kind: EdgeKind.Represents, via: null, from: name, to: concept });
    }
    const fallback = represents[0] ?? "";
    const stageTerm = (term: TermInput, parentId: NodeId | null): void => {
      const id = `${name}.${term.id}`;
      // A term is BOTH a language construct (`Term`) AND a class of its concept:
      // its concept lives in `type`, term-ness in `metaKind`, short id in `localId`.
      const node = this.makeNode(id, Tier.Instance, {
        type: term.concept ?? fallback,
        metaKind: MetaKind.Term,
        isClass: true,
        localId: term.id,
      });
      if (term.attrs !== undefined) for (const [key, value] of term.attrs) node.attrs.set(key, value);
      this.stagedNodes.push(node);
      this.stagedEdges.push({ kind: EdgeKind.Contains, via: null, from: name, to: id });
      for (const rel of term.relationships ?? []) {
        this.stagedEdges.push({ kind: EdgeKind.Relationship, via: rel.name, from: id, to: rel.target });
      }
      if (parentId !== null) {
        this.stagedEdges.push({ kind: EdgeKind.Narrower, via: null, from: parentId, to: id });
      }
      for (const child of term.children ?? []) stageTerm(child, id);
    };
    for (const term of terms) stageTerm(term, null);
    return this;
  }

  /** Define an operator node (Ontology-tier): its glyph is the node id, a
   * `Targets` edge points at the bound concept, and `from`/`to`/`relationship`
   * attrs record the endpoint members (design §4). */
  defineOperator(
    glyph: NodeId,
    concept: NodeId,
    fromMember: string | null,
    toMember: string | null,
    relationship: string | null,
  ): this {
    this.stagedNodes.push(this.makeNode(glyph, Tier.Ontology, { metaKind: MetaKind.Operator }));
    if (fromMember !== null) this.stagedAttrs.push({ id: glyph, name: "from", value: fromMember });
    if (toMember !== null) this.stagedAttrs.push({ id: glyph, name: "to", value: toMember });
    if (relationship !== null) this.stagedAttrs.push({ id: glyph, name: "relationship", value: relationship });
    this.stagedEdges.push({ kind: EdgeKind.Targets, via: null, from: glyph, to: concept });
    return this;
  }

  /** Define a viewpoint node framing the given concepts (one Frames edge each). */
  defineViewpoint(name: NodeId, frames: readonly NodeId[]): this {
    this.stagedNodes.push(this.makeNode(name, Tier.Ontology, { metaKind: MetaKind.Viewpoint }));
    for (const concept of frames) {
      this.stagedEdges.push({ kind: EdgeKind.Frames, via: null, from: name, to: concept });
    }
    return this;
  }

  // ── Commit ──────────────────────────────────────────────────────────────

  /** Validate every staged reference, then apply all edits and clear staging. */
  commit(skipMissingTargets?: ReadonlySet<NodeId>): void {
    const willExist = new Set<NodeId>();
    for (const node of this.stagedNodes) {
      if (this.graph.hasNode(node.id) || willExist.has(node.id)) {
        throw new Error(`node "${node.id}" already exists`);
      }
      willExist.add(node.id);
    }

    const exists = (id: NodeId): boolean => this.graph.hasNode(id) || willExist.has(id);
    for (const attr of this.stagedAttrs) {
      if (!exists(attr.id)) {
        throw new Error(`cannot set "${attr.name}" on node "${attr.id}" — it does not exist`);
      }
    }
    for (const field of this.stagedFields) {
      if (!exists(field.concept)) {
        throw new Error(`cannot declare field "${field.decl.name}" on "${field.concept}" — it does not exist`);
      }
    }
    for (const edge of this.stagedEdges) {
      if (!exists(edge.from)) {
        throw new Error(`edge source "${edge.from}" does not exist`);
      }
      if (skipMissingTargets?.has(edge.to) && !exists(edge.to)) {
        continue; // known-undefined (already diagnosed by the loader) — drop the edge
      }
      if (!exists(edge.to)) {
        throw new Error(`edge target "${edge.to}" does not exist`);
      }
    }

    for (const node of this.stagedNodes) {
      this.graph.addNode(node);
    }
    for (const attr of this.stagedAttrs) {
      this.graph.setAttr(attr.id, attr.name, attr.value);
    }
    for (const edge of this.stagedEdges) {
      if (skipMissingTargets?.has(edge.to) && !this.graph.hasNode(edge.to)) continue;
      this.graph.addEdge({ kind: edge.kind, via: edge.via, from: edge.from, to: edge.to });
    }
    for (const field of this.stagedFields) {
      this.graph.addFieldDecl(field.concept, field.decl);
    }

    this.stagedNodes.length = 0;
    this.stagedAttrs.length = 0;
    this.stagedEdges.length = 0;
    this.stagedFields.length = 0;
  }

  /** Build a fresh {@link Node} with the current namespace and all root fields
   *  defaulted; `opts` fills the structural fields the caller cares about. */
  private makeNode(
    id: NodeId,
    tier: Tier,
    opts: {
      type?: NodeId | null;
      metaKind?: MetaKind | null;
      isClass?: boolean;
      localId?: string | null;
      class?: NodeId | null;
    } = {},
  ): Node {
    return {
      id,
      tier,
      type: opts.type ?? null,
      metaKind: opts.metaKind ?? null,
      namespace: this.currentNamespace,
      localId: opts.localId ?? null,
      isClass: opts.isClass ?? false,
      class: opts.class ?? null,
      storageId: null,
      fields: [],
      attrs: new Map<string, Scalar>(),
    };
  }
}
