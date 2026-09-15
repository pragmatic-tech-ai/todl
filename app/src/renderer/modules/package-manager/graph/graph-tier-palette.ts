import { GraphTier } from "./todl-graph-model.js";

// Scheme-aware tile fills for the graph viewer, kept free of any mural import so
// the mapping is unit-testable in isolation (GraphProjection itself pulls in
// mural/framework, which the node test runner can't resolve). Returns a hex
// string; GraphProjection wraps it in a mural Color/SolidColorBrush.
//
// Distinct low-saturation washes so the three tiers read apart: light tints for a
// light canvas, dark tints for a dark one — paired with the diagram's adaptive
// @OnSurface label ink so text stays legible in either scheme.
export class GraphTierPalette {
  static fillHex(tier: GraphTier, isDark: boolean): string {
    if (isDark) {
      switch (tier) {
        case GraphTier.Meta: return "#3a2f3f"; // dark lavender
        case GraphTier.Ontology: return "#263445"; // dark blue
        default: return "#24352a"; // dark green — Instance
      }
    }
    switch (tier) {
      case GraphTier.Meta: return "#f3e5f5"; // lavender
      case GraphTier.Ontology: return "#e3f2fd"; // light blue
      default: return "#e8f5e9"; // light green — Instance
    }
  }
}
