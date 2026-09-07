import {
  ServiceBase,
  MuralBase,
  MetaData,
  ObservableCollection,
  type IServiceProvider,
} from "@pragmatic-tech-ai/mural/runtime";
import { ContentHostService, type IActivatable } from "@pragmatic-tech-ai/mural/framework";
import { RegistryClient } from "../../services/registry/registry-client.js";
import { CompileResultVM } from "./compile-result-vm.js";
import { CompilerAction, PackageCompilerActionVM } from "./package-compiler-action-vm.js";

// The Package Compiler capability's backing service. Opens a project directory,
// compiles it into a package (written under <dir>/dist), shows the resulting
// CompiledPackage in the central content host, and — after a confirm —
// publishes the compiled output to the registry.
//
// The actions are a ListBox in the side panel (interactive buttons don't
// receive input in the pane body in this build, but ListBox rows do): selecting
// a row runs it, then the selection is cleared so the same action can re-run.
// Publish is outward-facing, so it takes two selections: the first arms, the
// second publishes.
export class PackageCompilerService extends ServiceBase implements IActivatable {
  static readonly DirectoryKey = MuralBase.RegisterProperty<string>(
    PackageCompilerService, "Directory", "No directory opened.", MetaData.None);
  static readonly StatusKey = MuralBase.RegisterProperty<string>(
    PackageCompilerService, "Status", "Select “Open Directory” to begin.", MetaData.None);
  static readonly ActionsKey = MuralBase.RegisterProperty<ObservableCollection<PackageCompilerActionVM>>(
    PackageCompilerService, "Actions", undefined as unknown as ObservableCollection<PackageCompilerActionVM>, MetaData.None);
  static readonly SelectedActionKey = MuralBase.RegisterProperty<PackageCompilerActionVM | undefined>(
    PackageCompilerService, "SelectedAction", undefined, MetaData.None);

  get Directory(): string { return this.get_property_value(PackageCompilerService.DirectoryKey); }
  get Status(): string { return this.get_property_value(PackageCompilerService.StatusKey); }
  get Actions(): ObservableCollection<PackageCompilerActionVM> { return this.get_property_value(PackageCompilerService.ActionsKey); }
  get SelectedAction(): PackageCompilerActionVM | undefined { return this.get_property_value(PackageCompilerService.SelectedActionKey); }
  set SelectedAction(v: PackageCompilerActionVM | undefined) { this.set_property_value(PackageCompilerService.SelectedActionKey, v); }

  private readonly registry: RegistryClient;
  private readonly contentHost: ContentHostService;
  private dir: string | undefined; // the opened project directory
  private outDir: string | undefined; // compiled output dir (set on a successful compile)
  private resultView: CompileResultVM | undefined;
  private awaitingConfirm = false;

  constructor(provider: IServiceProvider) {
    super(provider);
    this.registry = provider.getRequired(RegistryClient);
    this.contentHost = provider.getRequired(ContentHostService.Key);
    const actions = new ObservableCollection<PackageCompilerActionVM>();
    actions.Add(new PackageCompilerActionVM("Open Directory", CompilerAction.Open));
    actions.Add(new PackageCompilerActionVM("Compile", CompilerAction.Compile));
    actions.Add(new PackageCompilerActionVM("Publish", CompilerAction.Publish));
    this.set_property_value(PackageCompilerService.ActionsKey, actions);
    this.AddPropertyChangedListener(PackageCompilerService.SelectedActionKey, () => this.onActionSelected());
  }

  // IActivatable — re-present this capability's last compile result into the
  // shared content host (which may hold another capability's content).
  OnActivated(): void {
    this.contentHost.View(this.resultView);
  }

  private setStatus(v: string): void { this.set_property_value(PackageCompilerService.StatusKey, v); }

  // A ListBox row was picked — run it, then clear the selection so re-picking
  // the same action fires again.
  private onActionSelected(): void {
    const action = this.SelectedAction;
    if (action === undefined) return;
    this.set_property_value(PackageCompilerService.SelectedActionKey, undefined);
    switch (action.Kind) {
      case CompilerAction.Open: void this.openDirectory(); break;
      case CompilerAction.Compile: void this.compile(); break;
      case CompilerAction.Publish: this.publish(); break;
    }
  }

  private async openDirectory(): Promise<void> {
    const dir = await this.registry.pickDirectory();
    if (dir.length === 0) return; // canceled
    this.dir = dir;
    this.set_property_value(PackageCompilerService.DirectoryKey, dir);
    this.outDir = undefined;
    this.resultView = undefined;
    this.awaitingConfirm = false;
    this.setStatus("Ready to compile.");
    this.contentHost.View(undefined);
  }

  private async compile(): Promise<void> {
    if (this.dir === undefined) {
      this.setStatus("Open a directory first.");
      return;
    }
    this.awaitingConfirm = false;
    this.outDir = undefined;
    this.setStatus("Compiling…");
    try {
      const result = await this.registry.compileDir(this.dir);
      this.resultView = new CompileResultVM(result);
      this.contentHost.View(this.resultView);
      if (result.ok) {
        this.outDir = result.outDir;
        this.setStatus("Compiled. Select “Publish” when ready.");
      } else {
        this.setStatus(`Compile failed — ${result.diagnostics.length} diagnostic(s).`);
      }
    } catch (e) {
      this.setStatus("Compile error: " + (e as Error).message);
    }
  }

  // Two-step publish: the first selection arms (publishing is outward-facing),
  // the second publishes the compiled output directory.
  private publish(): void {
    if (this.outDir === undefined) {
      this.setStatus("Nothing to publish — compile first.");
      return;
    }
    if (!this.awaitingConfirm) {
      this.awaitingConfirm = true;
      this.setStatus("Publish to the registry? Select “Publish” again to confirm.");
      return;
    }
    this.awaitingConfirm = false;
    void this.doPublish(this.outDir);
  }

  private async doPublish(outDir: string): Promise<void> {
    this.setStatus("Publishing…");
    try {
      await this.registry.publishDir(outDir);
      this.setStatus("Published.");
    } catch (e) {
      this.setStatus("Publish failed: " + (e as Error).message);
    }
  }
}
