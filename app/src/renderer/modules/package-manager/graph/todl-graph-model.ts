// The tier a graph node belongs to, mirroring TODL's compiled `tier` string
// ("Meta" / "Ontology" / "Instance"). A real enum so the viewer never
// string-compares raw tier values and the tier-filter toggles bind members.
export enum GraphTier {
  Meta = "Meta",
  Ontology = "Ontology",
  Instance = "Instance",
}

// A node projected for display: the join id, the primary label (name ?? id), the
// typeOf subtitle (resolved to the type node's name when that node is in the
// document, else the raw typeOf id), and the tier that drives fill + filtering.
export interface GraphViewNode {
  readonly id: string;
  readonly label: string;
  readonly subtitle: string;
  readonly tier: GraphTier;
}

// An edge projected for display: endpoints (node ids) + the connector label —
// the edge kind, suffixed with the `via` member name when the edge carries one.
export interface GraphViewEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly label: string;
}

// A projected node/edge set after applying a tier (+ optional edge-kind) filter.
export interface GraphViewSlice {
  readonly nodes: readonly GraphViewNode[];
  readonly edges: readonly GraphViewEdge[];
}

type Scalar = string | number | boolean;

interface RawNode { id: string; tier: string; typeOf: string; attrs: Record<string, Scalar>; }
interface RawEdge { kind: string; via: string | null; from: string; to: string; }
interface RawDocument { nodes: RawNode[]; edges: RawEdge[]; }

// Parses a compiled-graph TodlDocument JSON into a display model. Owns the read
// side only — the pure transform from persisted JSON to labelled nodes/edges plus
// tier/kind filtering. Rendering (Figures, Connectors, layout) lives in
// GraphProjection, which consumes this. Pure and mural-free so it unit-tests
// without a diagram host.
export class TodlGraphModel {
  private readonly _nodes: GraphViewNode[];
  private readonly _edges: GraphViewEdge[];

  // Build from raw JSON text. Accepts both the bare `{ nodes, edges }` document
  // and the persisted `{ diagnostics, document }` wrapper.
  constructor(json: string) {
    const doc = TodlGraphModel.unwrap(JSON.parse(json) as unknown);
    const nameById = TodlGraphModel.indexNames(doc.nodes);
    this._nodes = doc.nodes.map((n) => TodlGraphModel.projectNode(n, nameById));
    this._edges = doc.edges.map((e) => TodlGraphModel.projectEdge(e));
  }

  get Nodes(): readonly GraphViewNode[] { return this._nodes; }
  get Edges(): readonly GraphViewEdge[] { return this._edges; }

  // Every tier present, in canonical Meta→Ontology→Instance order.
  Tiers(): readonly GraphTier[] {
    const present = new Set(this._nodes.map((n) => n.tier));
    return [GraphTier.Meta, GraphTier.Ontology, GraphTier.Instance].filter((t) => present.has(t));
  }

  // Every distinct edge kind present, sorted.
  EdgeKinds(): readonly string[] {
    return [...new Set(this._edges.map((e) => e.kind))].sort();
  }

  // The subgraph limited to `tiers` (and, when provided, `kinds`). A node is kept
  // when its tier is admitted; an edge is kept when its kind is admitted AND both
  // endpoints survive the node filter.
  Slice(tiers: ReadonlySet<GraphTier>, kinds?: ReadonlySet<string>): GraphViewSlice {
    const nodes = this._nodes.filter((n) => tiers.has(n.tier));
    const live = new Set(nodes.map((n) => n.id));
    const edges = this._edges.filter(
      (e) => (kinds === undefined || kinds.has(e.kind)) && live.has(e.from) && live.has(e.to),
    );
    return { nodes, edges };
  }

  // Peel the `{ diagnostics, document }` persistence wrapper when present;
  // otherwise treat the parsed value as the document. Missing arrays → empty.
  private static unwrap(parsed: unknown): RawDocument {
    const obj = (parsed ?? {}) as Record<string, unknown>;
    const inner = (obj.document ?? obj) as Record<string, unknown>;
    const nodes = Array.isArray(inner.nodes) ? (inner.nodes as RawNode[]) : [];
    const edges = Array.isArray(inner.edges) ? (inner.edges as RawEdge[]) : [];
    return { nodes, edges };
  }

  // id → display name (the conventional `name` attr) for typeOf resolution.
  private static indexNames(nodes: readonly RawNode[]): Map<string, string> {
    const byId = new Map<string, string>();
    for (const n of nodes) {
      const name = n.attrs?.name;
      if (typeof name === "string" && name.length > 0) byId.set(n.id, name);
    }
    return byId;
  }

  private static projectNode(node: RawNode, nameById: ReadonlyMap<string, string>): GraphViewNode {
    const name = node.attrs?.name;
    const label = typeof name === "string" && name.length > 0 ? name : node.id;
    return {
      id: node.id,
      label,
      subtitle: nameById.get(node.typeOf) ?? node.typeOf,
      tier: TodlGraphModel.tierOf(node.tier),
    };
  }

  private static projectEdge(edge: RawEdge): GraphViewEdge {
    const label = edge.via !== null && edge.via.length > 0 ? `${edge.kind}: ${edge.via}` : edge.kind;
    return { from: edge.from, to: edge.to, kind: edge.kind, label };
  }

  // Map a compiled tier string to a GraphTier; an unrecognised value falls back
  // to Instance so the node still renders rather than vanishing from every filter.
  private static tierOf(tier: string): GraphTier {
    switch (tier) {
      case GraphTier.Meta: return GraphTier.Meta;
      case GraphTier.Ontology: return GraphTier.Ontology;
      default: return GraphTier.Instance;
    }
  }
}
