import { Figure, Connector, ConnectorEndpoint } from "@pragmatic-tech-ai/mural/framework";
import { Color, SolidColorBrush } from "@pragmatic-tech-ai/mural/visual-engine";
import { GraphLayout } from "./graph-layout.js";
import { GraphTier, type GraphViewNode, type GraphViewSlice } from "./todl-graph-model.js";

// Turns a filtered graph slice into laid-out mural Figures + Connectors. Layout is
// the dependency-free GraphLayout; this class owns the mapping of a graph node → a
// labelled, tier-coloured tile and an edge → a captioned connector between tiles.
export class GraphProjection {
  private static readonly TILE_W = 150;
  private static readonly TILE_H = 56;

  constructor(private readonly slice: GraphViewSlice) {}

  materialize(): { figures: Figure[]; connectors: Connector[] } {
    const pos = new GraphLayout(
      this.slice.nodes.map((n) => n.id),
      this.slice.edges,
    ).compute();

    const byId = new Map<string, Figure>();
    const figures = this.slice.nodes.map((n) => {
      const p = pos.get(n.id) ?? { x: 0, y: 0 };
      const f = Figure.fromKind("rectangle", p.x, p.y, { width: GraphProjection.TILE_W, height: GraphProjection.TILE_H });
      f.Id = n.id;
      f.LabelText = GraphProjection.captionOf(n);
      f.Fill = new SolidColorBrush(GraphProjection.fillOf(n.tier));
      byId.set(n.id, f);
      return f;
    });

    const connectors: Connector[] = [];
    for (const e of this.slice.edges) {
      const source = byId.get(e.from);
      const target = byId.get(e.to);
      if (source === undefined || target === undefined) continue;
      const c = new Connector();
      c.Source = new ConnectorEndpoint({ Node: source });
      c.Target = new ConnectorEndpoint({ Node: target });
      c.LabelText = e.label;
      connectors.push(c);
    }
    return { figures, connectors };
  }

  // Two-line tile caption: the node's label over its typeOf subtitle.
  private static captionOf(node: GraphViewNode): string {
    return node.subtitle.length > 0 ? `${node.label}\n${node.subtitle}` : node.label;
  }

  // Tier → tile fill; distinct low-saturation washes so the three tiers read apart.
  private static fillOf(tier: GraphTier): Color {
    switch (tier) {
      case GraphTier.Meta: return Color.FromHex("#f3e5f5"); // lavender
      case GraphTier.Ontology: return Color.FromHex("#e3f2fd"); // light blue
      default: return Color.FromHex("#e8f5e9"); // light green — Instance
    }
  }
}
