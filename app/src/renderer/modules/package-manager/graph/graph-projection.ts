import { Figure, Connector, ConnectorEndpoint } from "@pragmatic-tech-ai/mural/framework";
import { Color, SolidColorBrush, ThemeManager } from "@pragmatic-tech-ai/mural/visual-engine";
import { GraphLayout } from "./graph-layout.js";
import { GraphTierPalette } from "./graph-tier-palette.js";
import { type GraphViewNode, type GraphViewSlice } from "./todl-graph-model.js";

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

    // Resolve the tier palette against the active scheme once, so tiles read on a
    // dark canvas (dark tints + light @OnSurface label ink) or a light one. The
    // canvas paper itself follows @DiagramCanvas via the GraphCanvasPanel.
    const isDark = GraphProjection.activeSchemeIsDark();

    const byId = new Map<string, Figure>();
    const figures = this.slice.nodes.map((n) => {
      const p = pos.get(n.id) ?? { x: 0, y: 0 };
      const f = Figure.fromKind("rectangle", p.x, p.y, { width: GraphProjection.TILE_W, height: GraphProjection.TILE_H });
      f.Id = n.id;
      f.LabelText = GraphProjection.captionOf(n);
      f.Fill = new SolidColorBrush(Color.FromHex(GraphTierPalette.fillHex(n.tier, isDark)));
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

  // True when the active theme scheme is a dark one. Name-based (schemes are
  // "MaterialLight" / "MaterialDark"); matches case-insensitively on "dark" so an
  // internal prefix (e.g. "_MaterialDark") still resolves. Defaults to light when
  // no scheme is active (headless/tests before a theme mounts).
  private static activeSchemeIsDark(): boolean {
    const name = ThemeManager.ActiveScheme?.name ?? "";
    return name.toLowerCase().includes("dark");
  }
}
