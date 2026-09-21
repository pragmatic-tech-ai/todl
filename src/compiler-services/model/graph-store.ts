/**
 * Storage seam under {@link Graph} (design spec §9). A GraphStore holds nodes,
 * dual edge adjacency, and the type index; it knows nothing of the change bus or
 * derived traversals (those live on Graph). Swapping the store — in-memory here,
 * a graph DB later — leaves the Repository/Graph API unchanged.
 */

import { type Node, type Edge, type NodeId, type Scalar, type FieldDecl } from "./graph.js";
import { type MetaKind } from "./kinds.js";

export interface GraphStore
{
  getNode(id: NodeId): Node | undefined;
  hasNode(id: NodeId): boolean;
  readonly nodeCount: number;
  allNodes(): Node[];
  instancesOf(type: NodeId): NodeId[];
  nodesOfMetaKind(kind: MetaKind): NodeId[];
  outEdges(id: NodeId): Edge[];
  inEdges(id: NodeId): Edge[];
  addNode(node: Node): void;
  addEdge(edge: Edge): void;
  addFieldDecl(concept: NodeId, decl: FieldDecl): void;
  setAttr(id: NodeId, name: string, value: Scalar): void;
  remove(id: NodeId): void;
  commit(): void;
}

export class InMemoryGraphStore implements GraphStore
{
  private readonly _nodes = new Map<NodeId, Node>();
  private readonly _out = new Map<NodeId, Edge[]>();
  private readonly _in = new Map<NodeId, Edge[]>();
  private readonly _byType = new Map<NodeId, Set<NodeId>>();
  private readonly _byMetaKind = new Map<MetaKind, Set<NodeId>>();

  getNode(id: NodeId): Node | undefined
  {
    return this._nodes.get(id);
  }

  hasNode(id: NodeId): boolean
  {
    return this._nodes.has(id);
  }

  get nodeCount(): number
  {
    return this._nodes.size;
  }

  allNodes(): Node[]
  {
    return [...this._nodes.values()];
  }

  instancesOf(type: NodeId): NodeId[]
  {
    const bucket = this._byType.get(type);
    return bucket === undefined ? [] : [...bucket];
  }

  nodesOfMetaKind(kind: MetaKind): NodeId[]
  {
    const bucket = this._byMetaKind.get(kind);
    return bucket === undefined ? [] : [...bucket];
  }

  outEdges(id: NodeId): Edge[]
  {
    return this._out.get(id) ?? [];
  }

  inEdges(id: NodeId): Edge[]
  {
    return this._in.get(id) ?? [];
  }

  addNode(node: Node): void
  {
    if (this._nodes.has(node.id))
    {
      throw new Error(`node "${node.id}" already exists`);
    }
    this._nodes.set(node.id, node);
    if (node.type !== null)
    {
      let bucket = this._byType.get(node.type);
      if (bucket === undefined)
      {
        bucket = new Set<NodeId>();
        this._byType.set(node.type, bucket);
      }
      bucket.add(node.id);
    }
    if (node.metaKind !== null)
    {
      let bucket = this._byMetaKind.get(node.metaKind);
      if (bucket === undefined)
      {
        bucket = new Set<NodeId>();
        this._byMetaKind.set(node.metaKind, bucket);
      }
      bucket.add(node.id);
    }
  }

  addEdge(edge: Edge): void
  {
    if (!this._nodes.has(edge.from))
    {
      throw new Error(`edge source "${edge.from}" does not exist`);
    }
    if (!this._nodes.has(edge.to))
    {
      throw new Error(`edge target "${edge.to}" does not exist`);
    }
    appendEdge(this._out, edge.from, edge);
    appendEdge(this._in, edge.to, edge);
  }

  addFieldDecl(concept: NodeId, decl: FieldDecl): void
  {
    const node = this._nodes.get(concept);
    if (node === undefined)
    {
      throw new Error(`node "${concept}" does not exist`);
    }
    node.fields.push(decl);
  }

  setAttr(id: NodeId, name: string, value: Scalar): void
  {
    const node = this._nodes.get(id);
    if (node === undefined)
    {
      throw new Error(`node "${id}" does not exist`);
    }
    node.attrs.set(name, value);
  }

  remove(id: NodeId): void
  {
    const node = this._nodes.get(id);
    if (node === undefined)
    {
      throw new Error(`node "${id}" does not exist`);
    }
    for (const e of this._out.get(id) ?? [])
    {
      const rev = this._in.get(e.to);
      if (rev !== undefined) this._in.set(e.to, rev.filter((x) => x !== e));
    }
    for (const e of this._in.get(id) ?? [])
    {
      const fwd = this._out.get(e.from);
      if (fwd !== undefined) this._out.set(e.from, fwd.filter((x) => x !== e));
    }
    this._out.delete(id);
    this._in.delete(id);
    if (node.type !== null)
    {
      const bucket = this._byType.get(node.type);
      if (bucket !== undefined)
      {
        bucket.delete(id);
        if (bucket.size === 0) this._byType.delete(node.type);
      }
    }
    if (node.metaKind !== null)
    {
      const bucket = this._byMetaKind.get(node.metaKind);
      if (bucket !== undefined)
      {
        bucket.delete(id);
        if (bucket.size === 0) this._byMetaKind.delete(node.metaKind);
      }
    }
    this._nodes.delete(id);
  }

  commit(): void
  {
    // in-memory: writes are already applied
  }
}

function appendEdge(index: Map<NodeId, Edge[]>, key: NodeId, edge: Edge): void
{
  const list = index.get(key);
  if (list === undefined)
  {
    index.set(key, [edge]);
  }
  else
  {
    list.push(edge);
  }
}
