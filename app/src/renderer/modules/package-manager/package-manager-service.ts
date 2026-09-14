import {
  ServiceBase,
  ObservableCollection,
  type IServiceProvider,
} from "@pragmatic-tech-ai/mural/runtime";
import { ContentHostService, type IActivatable } from "@pragmatic-tech-ai/mural/framework";
import { RegistryClient } from "../../services/registry/registry-client.js";
import { PackageManagerHeaderVM } from "./package-manager-header-vm.js";
import { EditorPaneVM } from "./editor-pane-vm.js";
import { GraphPaneVM } from "./graph/graph-pane-vm.js";
import { TreeNodeVM } from "./tree-node-vm.js";
import { EditorLanguage } from "../../editor/monaco-editor-host.js";

// The Package Manager capability's backing service. Connects to the registry
// (via the shared RegistryClient) and drives two regions: the side panel shows a
// per-package content TreeView ($Roots, data-driven), and the central content
// host shows the shared editor pane. Selecting a content leaf routes its text +
// language into the editor.
//
// A ServiceBase (bindable, MuralBase-backed) so the side-panel template binds
// $Status / $Roots / $SelectedNode directly. Fetches lazily: OnActivated loads
// the package name list on first open; each package's tarball contents are
// fetched the first time its node is expanded (TreeNodeVM.OnExpand). The header
// Refresh command reloads the list.
export class PackageManagerService extends ServiceBase implements IActivatable {
  private _status = "";
  private readonly _roots = new ObservableCollection<TreeNodeVM>();
  private _selectedNode: TreeNodeVM | undefined = undefined;
  private _commands: PackageManagerHeaderVM = undefined as unknown as PackageManagerHeaderVM;

  get Status(): string { return this._status; }
  get Roots(): ObservableCollection<TreeNodeVM> { return this._roots; }
  get SelectedNode(): TreeNodeVM | undefined { return this._selectedNode; }
  set SelectedNode(v: TreeNodeVM | undefined) {
    const old = this._selectedNode;
    this._selectedNode = v;
    this.RaisePropertyChanged("SelectedNode", old, v);
  }
  get Commands(): PackageManagerHeaderVM { return this._commands; }

  private setStatus(v: string): void {
    const old = this._status;
    this._status = v;
    this.RaisePropertyChanged("Status", old, v);
  }

  private readonly registry: RegistryClient;
  private readonly contentHost: ContentHostService;
  private readonly editorPane = new EditorPaneVM();
  // A compiled model.json leaf (e.g. "Raw model.json" / "Compiled code") routes
  // to this tabbed Visual+Text pane instead of the plain editor.
  private readonly graphPane = new GraphPaneVM();
  // Guards the lazy first load so re-selecting the capability doesn't refetch;
  // the Refresh command bypasses it (it always reloads).
  private loaded = false;

  constructor(provider: IServiceProvider) {
    super(provider);
    this.registry = provider.getRequired(RegistryClient);
    this.contentHost = provider.getRequired(ContentHostService.Key);
    // The side-pane command ToolBar's Refresh affordance (rendered via
    // DataTemplate[PackageManagerHeaderVM] as a ToolBar pinned atop the body).
    const oldCommands = this._commands;
    this._commands = new PackageManagerHeaderVM(() => this.refresh());
    this.RaisePropertyChanged("Commands", oldCommands, this._commands);
    // Selecting a tree node (SelectedDataItem binds two-way) shows a leaf's
    // content; branch/package rows carry none, so they no-op. A JSON leaf that
    // parses as a compiled TodlDocument graph (Raw model.json / Compiled code)
    // routes to the tabbed Visual+Text pane; everything else to the plain editor.
    this.PropertyChanged("SelectedNode").subscribe(() => {
      const content = this.SelectedNode?.Content;
      if (content === undefined) return;
      if (content.language === EditorLanguage.Json && GraphPaneVM.looksLikeGraph(content.text)) {
        this.graphPane.show(content.text);
        this.contentHost.View(this.graphPane);
      } else {
        this.editorPane.show(content.text, content.language);
        this.contentHost.View(this.editorPane);
      }
    });
  }

  // IActivatable — the capability became active. Load the list once on first
  // open, and (re-)present the shared editor pane into the content host, which
  // may hold another capability's content after a switch.
  OnActivated(): void {
    if (!this.loaded) void this.load();
    this.contentHost.View(this.editorPane);
  }

  // Reload on demand (the header Refresh command).
  refresh(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.setStatus("Loading…");
    try {
      const names = await this.registry.list();
      const roots = this.Roots;
      roots.Clear();
      for (const name of names) roots.Add(TreeNodeVM.lazy(name, () => this.loadCategories(name)));
      this.loaded = true;
      this.setStatus(names.length === 0 ? "No packages in the registry." : "");
    } catch (e) {
      this.setStatus("Could not reach the registry: " + (e as Error).message);
    }
  }

  // Fetch a package's tarball contents (one round-trip) and build its category
  // nodes: Files (each .todl), Metadata, package.json, Compiled code, Raw
  // model.json, Dependencies, Published versions.
  private async loadCategories(name: string): Promise<TreeNodeVM[]> {
    const c = await this.registry.getPackageContents(name);
    const nodes: TreeNodeVM[] = [];
    if (c.files.length > 0) {
      nodes.push(TreeNodeVM.branch("Files", c.files.map((f) => TreeNodeVM.leaf(f.name, f.text, EditorLanguage.Todl))));
    }
    nodes.push(TreeNodeVM.leaf("Metadata", c.metadata, EditorLanguage.Json));
    nodes.push(TreeNodeVM.leaf("package.json", c.packageJson, EditorLanguage.Json));
    nodes.push(TreeNodeVM.leaf("Compiled code", c.compiled, EditorLanguage.Json));
    nodes.push(TreeNodeVM.leaf("Raw model.json", c.rawModel, EditorLanguage.Json));
    if (c.resources.length > 0) {
      nodes.push(TreeNodeVM.branch("Resources",
        c.resources.map((r) => TreeNodeVM.leaf(r.name, r.text, PackageManagerService.languageFor(r.name)))));
    }
    nodes.push(TreeNodeVM.branch("Dependencies", c.dependencies.map((d) => TreeNodeVM.leaf(d, d, EditorLanguage.PlainText))));
    nodes.push(TreeNodeVM.branch("Published versions",
      c.versions.map((v) => TreeNodeVM.leaf(v, v === c.latest ? `${v}  (latest)` : v, EditorLanguage.PlainText))));
    return nodes;
  }

  // The editor language for a resource file, inferred from its extension.
  private static languageFor(name: string): EditorLanguage {
    if (name.endsWith(".json")) return EditorLanguage.Json;
    if (name.endsWith(".todl")) return EditorLanguage.Todl;
    return EditorLanguage.PlainText;
  }
}
