// A computed node position (top-left, diagram units).
export interface LayoutPosition {
  readonly x: number;
  readonly y: number;
}

interface LayoutEdge {
  readonly from: string;
  readonly to: string;
}

// A small dependency-free layered ("Sugiyama-lite") layout: assigns each node a
// layer by longest path from a source and lays layers out top-to-bottom, nodes
// within a layer left-to-right. Cycles are broken by dropping DFS back-edges so
// the layering terminates. Good enough for a read-only graph viewer without
// pulling in a full layout engine; the projection owns tile size/spacing.
export class GraphLayout {
  private static readonly COL_DX = 210;
  private static readonly ROW_DY = 120;

  constructor(
    private readonly nodeIds: readonly string[],
    private readonly edges: ReadonlyArray<LayoutEdge>,
  ) {}

  compute(): Map<string, LayoutPosition> {
    const ids = new Set(this.nodeIds);
    const adj = this.acyclicAdjacency(ids);
    const layer = this.assignLayers(adj);
    return this.place(layer);
  }

  // Adjacency with back-edges removed (DFS three-colour): an edge to a node
  // currently on the recursion stack closes a cycle and is dropped.
  private acyclicAdjacency(ids: Set<string>): Map<string, string[]> {
    const raw = new Map<string, string[]>();
    for (const id of this.nodeIds) raw.set(id, []);
    for (const e of this.edges) {
      if (ids.has(e.from) && ids.has(e.to) && e.from !== e.to) raw.get(e.from)!.push(e.to);
    }
    const adj = new Map<string, string[]>();
    for (const id of this.nodeIds) adj.set(id, []);
    const state = new Map<string, number>(); // 0 unvisited, 1 on-stack, 2 done
    const visit = (u: string): void => {
      state.set(u, 1);
      for (const v of raw.get(u)!) {
        const s = state.get(v) ?? 0;
        if (s === 1) continue; // back-edge → drop
        adj.get(u)!.push(v);
        if (s === 0) visit(v);
      }
      state.set(u, 2);
    };
    for (const id of this.nodeIds) if ((state.get(id) ?? 0) === 0) visit(id);
    return adj;
  }

  // Longest-path layering over the acyclic adjacency (Kahn order): sources are
  // layer 0; layer(v) = max(layer(u)+1) over kept edges u→v.
  private assignLayers(adj: Map<string, string[]>): Map<string, number> {
    const indeg = new Map<string, number>();
    for (const id of this.nodeIds) indeg.set(id, 0);
    for (const [, outs] of adj) for (const v of outs) indeg.set(v, (indeg.get(v) ?? 0) + 1);

    const layer = new Map<string, number>();
    const queue: string[] = [];
    for (const id of this.nodeIds) if ((indeg.get(id) ?? 0) === 0) { layer.set(id, 0); queue.push(id); }
    while (queue.length > 0) {
      const u = queue.shift()!;
      const lu = layer.get(u) ?? 0;
      for (const v of adj.get(u)!) {
        layer.set(v, Math.max(layer.get(v) ?? 0, lu + 1));
        const d = (indeg.get(v) ?? 0) - 1;
        indeg.set(v, d);
        if (d === 0) queue.push(v);
      }
    }
    for (const id of this.nodeIds) if (!layer.has(id)) layer.set(id, 0);
    return layer;
  }

  // Place nodes: layer → row (y), sequence within a layer → column (x). Uses the
  // input node order for determinism.
  private place(layer: Map<string, number>): Map<string, LayoutPosition> {
    const nextCol = new Map<number, number>();
    const pos = new Map<string, LayoutPosition>();
    for (const id of this.nodeIds) {
      const l = layer.get(id) ?? 0;
      const col = nextCol.get(l) ?? 0;
      nextCol.set(l, col + 1);
      pos.set(id, { x: col * GraphLayout.COL_DX, y: l * GraphLayout.ROW_DY });
    }
    return pos;
  }
}
