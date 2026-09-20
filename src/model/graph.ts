/**
 * The reflective typed graph — the runtime hub (design spec §1, §R1).
 *
 * Everything is a {@link Node}; every relationship is a typed {@link Edge}.
 * The store keeps dual adjacency (forward `out` + reverse `in`, so reverse
 * traversal is free) plus a type index (`byType`, backing `instancesOf`).
 * Filtered accessors and closure caching layer on top in a later step.
 */

import { Signal } from "@pragmatic-tech-ai/todl-runtime";
import { InMemoryGraphStore, type GraphStore } from "./graph-store.js";
import { MetaKind } from "./kinds.js";

export type NodeId = string;

/** Which layer of the reflective tower a node lives in (spec §1). */
export enum Tier
{
  Meta,
  Ontology,
  Instance,
}

/**
 * The structural kind of an edge. Domain-relationship and derived-member
 * *names* are data-driven (per-ontology) and cannot be enumerated, so they
 * are carried on {@link Edge.via} rather than baked into this enum.
 */
export enum EdgeKind
{
  TypeOf,
  Extends,
  Contains,
  HasRelationship,
  HasInvariant,
  Relationship,
  Derived,
  Narrower, // taxonomy hierarchy: broader term -> narrower term
  InstanceOf, // leaf -> class (identity instantiation)
  Represents, // taxonomy -> the concept it represents
  Annotated, // concept | package -> annotation application node
  Frames, // viewpoint -> the concept it frames
  Targets, // relationship-schema node -> a target concept node (one per union member)
}

/** Which way to walk an edge from a node. */
export enum Direction
{
  Out,
  In,
}

/**
 * Field / relationship multiplicity — the surface `T` / `T?` / `T[]` / `T[+]`.
 * Unified with the manifest's on-disk cardinality (SPEC-04 §3): the manifest
 * `enums.ts` is the single canonical owner (frozen codes One=0 … OneOrMore=3);
 * the model re-exports it so both tiers share one enum. `T[+]` = `OneOrMore`.
 */
import { Cardinality } from "../manifest/enums.js";
export { Cardinality };

/** A literal field value. Enum selections and references are edges, not attrs. */
export type Scalar = string | number | boolean;

/**
 * A concept's (or annotation's) declared field — name, declared type id, and
 * multiplicity. Carried directly on the owning {@link Node} (SPEC-01 #4): a
 * scalar field is pure schema with no navigable target, so it lives on the node
 * rather than as a separate member node reached by a `HasField` edge (which is
 * gone). Reference/relationship *members* keep their member nodes + `Targets`
 * edges (they carry a navigable target).
 */
export interface FieldDecl
{
  name: string;
  type: NodeId;
  cardinality: Cardinality;
}

export interface Node
{
  id: NodeId;
  tier: Tier;

  /** The concept the node is typed by (instance tier): the manifest TypeInfo /
   *  concept id it instantiates. `null` on a pure ontology-construct node.
   *  Replaces the instance-tier meaning of the old `typeOf` (SPEC-01). */
  type: NodeId | null;

  /** The language construct this node *is* (ontology tier); `Term` is first-class
   *  (#6). `null` on a pure instance. Replaces the ontology-tier meaning of the
   *  old `typeOf` (SPEC-01). */
  metaKind: MetaKind | null;

  /** Namespace (visibility / provenance). Was `attrs.namespace` (#1). */
  namespace: string | null;

  /** The node's own short id segment (e.g. `Surface`). Was `attrs.id` (#5). */
  localId: string | null;

  /** This node is a class — a partial, fixed-value definition. Was `attrs.class` (#5). */
  isClass: boolean;

  /** For an instance that is-a term/class: the term/Class id it instantiates
   *  (Axis-2 value-origin hook, SPEC-05). `null` = none. */
  class: NodeId | null;

  /** Reserved dedicated persistence id (#3). DEFERRED — a typed slot only. */
  storageId: string | null;

  /** Declared scalar/field schema of a concept or annotation (SPEC-01 #4). Carried
   *  here instead of as `HasField` member nodes; empty for non-schema-owning nodes. */
  fields: FieldDecl[];

  /** User-defined scalar field values ONLY. */
  attrs: Map<string, Scalar>;
}

export interface Edge
{
  kind: EdgeKind;
  /** For {@link EdgeKind.Relationship} / {@link EdgeKind.Derived}: the member node it realises; else `null`. */
  via: NodeId | null;
  from: NodeId;
  to: NodeId;
}

/** The kind of mutation reported on {@link Graph.changed}. */
export enum GraphChangeKind
{
  NodeAdded,
  NodeRemoved,
  EdgeAdded,
  EdgeRemoved,
  AttrSet,
}

/**
 * A single mutation event on the graph change bus (spec §R2). One applied
 * change → one event → façade re-raise, derived-cache invalidation, and
 * incremental validation all subscribe to the same stream.
 */
export interface GraphChangeArgs
{
  kind: GraphChangeKind;
  /** The node the change is about; for an edge, its source. */
  node: NodeId;
  /** Field / relationship name, or `null` for whole-node and structural changes. */
  property: string | null;
  /** For an edge change, the other endpoint (the item); `null` otherwise. */
  target: NodeId | null;
}

export class Graph
{
  private readonly store: GraphStore;

  /** The mutation event bus (spec §R2): one event per applied change. */
  readonly changed = new Signal<GraphChangeArgs>();

  /** Storage is a swappable {@link GraphStore} (spec §9); defaults to in-memory. */
  constructor(store: GraphStore = new InMemoryGraphStore())
  {
    this.store = store;
  }

  addNode(node: Node): void
  {
    this.store.addNode(node);
    this.changed.emit({ kind: GraphChangeKind.NodeAdded, node: node.id, property: null, target: null });
  }

  getNode(id: NodeId): Node | undefined
  {
    return this.store.getNode(id);
  }

  hasNode(id: NodeId): boolean
  {
    return this.store.hasNode(id);
  }

  get nodeCount(): number
  {
    return this.store.nodeCount;
  }

  /** Every node in the graph. */
  allNodes(): Node[]
  {
    return this.store.allNodes();
  }

  /** Node ids whose `type` (instance tier) is `concept`. */
  instancesOf(concept: NodeId): NodeId[]
  {
    return this.store.instancesOf(concept);
  }

  /** Node ids whose `metaKind` (ontology tier) is `kind` — e.g. every concept
   *  declaration, taxonomy, or viewpoint. Replaces the old `instancesOf(<sentinel>)`. */
  nodesOfMetaKind(kind: MetaKind): NodeId[]
  {
    return this.store.nodesOfMetaKind(kind);
  }

  addEdge(edge: Edge): void
  {
    this.store.addEdge(edge);
    const property =
      edge.kind === EdgeKind.Relationship || edge.kind === EdgeKind.Derived ? edge.via : null;
    this.changed.emit({ kind: GraphChangeKind.EdgeAdded, node: edge.from, property, target: edge.to });
  }

  /** Append a declared field to a concept/annotation node's schema (SPEC-01 #4). */
  addFieldDecl(concept: NodeId, decl: FieldDecl): void
  {
    this.store.addFieldDecl(concept, decl);
  }

  /** Set a scalar field value on a node and emit {@link GraphChangeKind.AttrSet}. */
  setAttr(id: NodeId, name: string, value: Scalar): void
  {
    this.store.setAttr(id, name, value);
    this.changed.emit({ kind: GraphChangeKind.AttrSet, node: id, property: name, target: null });
  }

  /** All edges leaving `id` (forward adjacency). */
  outEdges(id: NodeId): Edge[]
  {
    return this.store.outEdges(id);
  }

  /** All edges entering `id` (reverse adjacency). */
  inEdges(id: NodeId): Edge[]
  {
    return this.store.inEdges(id);
  }

  /**
   * Neighbours reached from `id` by edges of `kind` in `direction`. When `via`
   * is given, only domain-relationship / derived edges realising that member
   * match.
   */
  related(id: NodeId, kind: EdgeKind, direction: Direction, via: NodeId | null = null): NodeId[]
  {
    const edges = direction === Direction.Out ? this.outEdges(id) : this.inEdges(id);
    const result: NodeId[] = [];
    for (const edge of edges)
    {
      if (edge.kind !== kind) continue;
      if (via !== null && edge.via !== via) continue;
      result.push(direction === Direction.Out ? edge.to : edge.from);
    }
    return result;
  }

  /**
   * Transitive closure of {@link related} from `start`. `reflexive` includes
   * `start` itself (the `*` form; `false` gives the proper `+` form). Cycle-safe.
   */
  closure(
    start: NodeId,
    kind: EdgeKind,
    direction: Direction,
    reflexive: boolean,
    via: NodeId | null = null,
  ): NodeId[]
  {
    const seen = new Set<NodeId>();
    const result: NodeId[] = [];
    const queue: NodeId[] = this.related(start, kind, direction, via);
    let head = 0;
    while (head < queue.length)
    {
      const current = queue[head++];
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      result.push(current);
      for (const next of this.related(current, kind, direction, via))
      {
        if (!seen.has(next)) queue.push(next);
      }
    }
    if (reflexive && !seen.has(start))
    {
      result.unshift(start);
    }
    return result;
  }
}
