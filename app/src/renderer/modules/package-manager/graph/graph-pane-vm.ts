import { Observable, ObservableCollection } from "@pragmatic-tech-ai/mural/runtime";
import type { Figure, Connector } from "@pragmatic-tech-ai/mural/framework";
import { ConnectorRoutingScheduler } from "@pragmatic-tech-ai/mural/framework";
import { MonacoEditorHost, EditorLanguage } from "../../../editor/monaco-editor-host.js";
import { TodlGraphModel, GraphTier } from "./todl-graph-model.js";
import { GraphProjection } from "./graph-projection.js";

// The central content-host pane for a compiled-graph model.json: a TabControl with
// a "Visual" tab (a mural Diagram over projected Nodes/Connectors, with tier-filter
// toggles) and a "Text" tab (the raw JSON in a read-only Monaco). Reused across
// selections — `show(text)` re-parses and re-projects. Presented via
// DataTemplate[GraphPaneVM] (see package-manager.resources.mu).
export class GraphPaneVM extends Observable {
  private readonly editor = new MonacoEditorHost();
  private readonly _nodes = new ObservableCollection<Figure>();
  private readonly _connectors = new ObservableCollection<Connector>();
  private _model: TodlGraphModel | undefined;
  private _showText = false;
  private _showMeta = true;
  private _showOntology = true;
  private _showInstance = true;

  constructor() {
    super();
    this.editor.Language = EditorLanguage.Json;
    this.editor.ReadOnly = true;
    this.editor.Text = "Select a model.json node to view its graph.";
  }

  /** The read-only JSON editor shown on the "Text" tab. */
  get TextEditor(): MonacoEditorHost { return this.editor; }
  /** Projected node tiles for the "Visual" tab's Diagram (ItemsSource). */
  get Nodes(): ObservableCollection<Figure> { return this._nodes; }
  /** Projected edge connectors for the "Visual" tab's Diagram. */
  get Connectors(): ObservableCollection<Connector> { return this._connectors; }

  // View switch — the "Visual" (graph) vs "Text" (raw JSON) tabs. Mutually
  // exclusive: setting one flips the other, so the two header ToggleButtons read
  // as a radio pair.
  get ShowVisual(): boolean { return !this._showText; }
  set ShowVisual(v: boolean) { this.ShowText = !v; }
  get ShowText(): boolean { return this._showText; }
  set ShowText(v: boolean) {
    if (this._showText === v) return;
    this._showText = v;
    this.RaisePropertyChanged("ShowText", !v, v);
    this.RaisePropertyChanged("ShowVisual", v, !v);
  }

  get ShowMeta(): boolean { return this._showMeta; }
  set ShowMeta(v: boolean) { const o = this._showMeta; this._showMeta = v; this.RaisePropertyChanged("ShowMeta", o, v); this.rebuild(); }
  get ShowOntology(): boolean { return this._showOntology; }
  set ShowOntology(v: boolean) { const o = this._showOntology; this._showOntology = v; this.RaisePropertyChanged("ShowOntology", o, v); this.rebuild(); }
  get ShowInstance(): boolean { return this._showInstance; }
  set ShowInstance(v: boolean) { const o = this._showInstance; this._showInstance = v; this.RaisePropertyChanged("ShowInstance", o, v); this.rebuild(); }

  /** Whether `text` parses as a compiled TodlDocument graph (has nodes) — the
   *  gate the package manager uses to route a JSON leaf here vs. the plain editor. */
  static looksLikeGraph(text: string): boolean {
    try { return new TodlGraphModel(text).Nodes.length > 0; } catch { return false; }
  }

  /** Show `text`: seed the editor buffer and re-project the graph. */
  show(text: string): void {
    this.editor.Text = text;
    try { this._model = new TodlGraphModel(text); } catch { this._model = undefined; }
    this.rebuild();
  }

  private rebuild(): void {
    if (this._model === undefined) {
      this._nodes.Batch(() => this._nodes.Clear());
      this._connectors.Batch(() => this._connectors.Clear());
      return;
    }
    const tiers = new Set<GraphTier>();
    if (this._showMeta) tiers.add(GraphTier.Meta);
    if (this._showOntology) tiers.add(GraphTier.Ontology);
    if (this._showInstance) tiers.add(GraphTier.Instance);
    // Wrap projection + fill in a routing-suspend scope. GraphProjection sets
    // each Connector's Source/Target, which eagerly runs the O(k³) per-side
    // crossing optimizer against every connector already on a shared figure-side
    // → O(K⁴) at scale (~48s at 500/600). The scope defers routing + optimize to
    // one settle pass per side on exit (~48s → <1s). Must span materialize(),
    // where the connector wiring — hence the routing — actually happens.
    ConnectorRoutingScheduler.Batch(() => {
      const { figures, connectors } = new GraphProjection(this._model!.Slice(tiers)).materialize();
      // Populate each collection in a single Batch → one 'reset' per collection,
      // so the Diagram rebuilds figures + connectors in one pass (O(N+M) + one
      // layout) instead of a notification per Add (the hours-at-scale path).
      this._nodes.Batch(() => {
        this._nodes.Clear();
        for (const f of figures) this._nodes.Add(f);
      });
      this._connectors.Batch(() => {
        this._connectors.Clear();
        for (const c of connectors) this._connectors.Add(c);
      });
    });
  }
}
