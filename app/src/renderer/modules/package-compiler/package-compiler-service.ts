import {
  ServiceBase,
  ObservableCollection,
  type IServiceProvider,
} from "@pragmatic-tech-ai/mural/runtime";
import { ContentHostService, DialogService, type IActivatable } from "@pragmatic-tech-ai/mural/framework";
import { RegistryClient } from "../../services/registry/registry-client.js";
import { ConfirmDialog } from "../../services/dialogs/confirm-dialog.js";
import { CompileResultVM } from "./compile-result-vm.js";
import { FolderNodeVM } from "./folder-node-vm.js";
import { PackageCompilerHeaderVM } from "./package-compiler-header-vm.js";

// The Package Compiler capability's backing service. Opens a project directory,
// compiles it into a package (written under <dir>/dist), shows the resulting
// CompiledPackage in the central content host, and — after a confirm —
// publishes the compiled output to the registry.
//
// The commands are a ToolBar in the side pane (a PackageCompilerHeaderVM
// rendered by DataTemplate), each ToolBarButton bound to a RelayCommand back
// into this service. Open/Compile/Publish are always shown; Bump/Delete appear
// (via the header's ConflictVisible) only after a 409. Publish is
// outward-facing, so it prompts a modal Mural confirmation dialog first.
export class PackageCompilerService extends ServiceBase implements IActivatable {
  private _status = "Click “Open” to begin.";
  private _commands: PackageCompilerHeaderVM = undefined as unknown as PackageCompilerHeaderVM;
  // The opened folder's contents, as a lazy tree shown in the side pane.
  private readonly _tree = new ObservableCollection<FolderNodeVM>();

  get Status(): string { return this._status; }
  get Commands(): PackageCompilerHeaderVM { return this._commands; }
  get Tree(): ObservableCollection<FolderNodeVM> { return this._tree; }

  private readonly registry: RegistryClient;
  private readonly contentHost: ContentHostService;
  private readonly dialogs: DialogService;
  private readonly header: PackageCompilerHeaderVM;
  private dir: string | undefined; // the opened project directory
  private outDir: string | undefined; // compiled output dir (set on a successful compile)
  private resultView: CompileResultVM | undefined;
  private lastName: string | undefined; // compiled package identity, for conflict reactions
  private lastVersion: string | undefined;

  constructor(provider: IServiceProvider) {
    super(provider);
    this.registry = provider.getRequired(RegistryClient);
    this.contentHost = provider.getRequired(ContentHostService.Key);
    this.dialogs = provider.getRequired(DialogService.Key);
    this.header = new PackageCompilerHeaderVM({
      open: () => void this.openDirectory(),
      compile: () => void this.compile(),
      publish: () => void this.publish(),
      bump: () => void this.bumpAndRepublish(),
      delete: () => void this.deleteAndRepublish(),
    });
    const old = this._commands;
    this._commands = this.header;
    this.RaisePropertyChanged("Commands", old, this._commands);
  }

  // IActivatable — re-present this capability's last compile result into the
  // shared content host (which may hold another capability's content).
  OnActivated(): void {
    this.contentHost.View(this.resultView);
  }

  private setStatus(v: string): void {
    const old = this._status;
    this._status = v;
    this.RaisePropertyChanged("Status", old, v);
  }

  private async openDirectory(): Promise<void> {
    const dir = await this.registry.pickDirectory();
    if (dir.length === 0) return; // canceled
    this.dir = dir;
    this.outDir = undefined;
    this.resultView = undefined;
    this.setStatus("Ready to compile.");
    this.contentHost.View(undefined);
    await this.populateTree(dir);
  }

  // Fill the side-pane tree with the opened folder's top-level entries (folders
  // expand lazily via FolderNodeVM.OnExpand → loadDir).
  private async populateTree(dir: string): Promise<void> {
    const tree = this.Tree;
    tree.Clear();
    try {
      for (const node of await this.loadDir(dir)) tree.Add(node);
    } catch (e) {
      this.setStatus("Could not read folder: " + (e as Error).message);
    }
  }

  // Read one directory into folder/file nodes (dirs first, then files — the main
  // process sorts). Directories carry a loader that reads their own children.
  private async loadDir(path: string): Promise<FolderNodeVM[]> {
    const entries = await this.registry.readDir(path);
    return entries.map((e) =>
      e.isDirectory ? FolderNodeVM.dir(e.name, () => this.loadDir(e.path)) : FolderNodeVM.file(e.name),
    );
  }

  private async compile(): Promise<void> {
    if (this.dir === undefined) {
      this.setStatus("Open a directory first.");
      return;
    }
    this.outDir = undefined;
    this.setStatus("Compiling…");
    try {
      const result = await this.registry.compileDir(this.dir);
      this.resultView = new CompileResultVM(result);
      this.contentHost.View(this.resultView);
      if (result.ok) {
        this.outDir = result.outDir;
        this.lastName = result.name;
        this.lastVersion = result.version;
        this.setStatus("Compiled. Click “Publish” when ready.");
      } else {
        this.setStatus(`Compile failed — ${result.diagnostics.length} diagnostic(s).`);
      }
    } catch (e) {
      this.setStatus("Compile error: " + (e as Error).message);
    }
  }

  // Publishing is outward-facing, so it prompts a modal Mural confirmation
  // dialog before the compiled output directory is pushed to the registry.
  private async publish(): Promise<void> {
    if (this.outDir === undefined) {
      this.setStatus("Nothing to publish — compile first.");
      return;
    }
    const id = `${this.lastName ?? "this package"}${this.lastVersion === undefined ? "" : `@${this.lastVersion}`}`;
    const ok = await ConfirmDialog.show(this.dialogs, {
      title: "Publish package",
      message: `Publish ${id} to the registry? This uploads the compiled package to the configured registry.`,
      confirmLabel: "Publish",
    });
    if (!ok) {
      this.setStatus("Publish canceled.");
      return;
    }
    void this.doPublish(this.outDir);
  }

  private async doPublish(outDir: string): Promise<void> {
    this.setStatus("Publishing…");
    try {
      await this.registry.publishDir(outDir);
      this.clearConflictActions();
      this.setStatus("Published.");
    } catch (e) {
      const message = (e as Error).message;
      if (PackageCompilerService.isVersionConflict(message)) {
        this.offerConflictActions();
        this.setStatus(
          `Version ${this.lastVersion ?? ""} is already published. Use the toolbar’s ` +
          `overflow (⌄) → “Bump version” or “Delete version”.`,
        );
      } else {
        this.setStatus("Publish failed: " + message);
      }
    }
  }

  // A registry 409 — the version already exists (npm/GitHub Packages reject a
  // republish over an existing version).
  private static isVersionConflict(message: string): boolean {
    return message.includes("HTTP 409") || message.includes("existing version");
  }

  // Reaction A: bump the project to the next unused version, recompile, republish.
  private async bumpAndRepublish(): Promise<void> {
    if (this.dir === undefined) { this.setStatus("Open a directory first."); return; }
    this.setStatus("Bumping version…");
    try {
      const version = await this.registry.bumpVersion(this.dir);
      await this.compile(); // recompiles from the bumped manifest (updates outDir + identity)
      if (this.outDir === undefined) return; // compile surfaced its own error
      this.setStatus(`Bumped to ${version}. Publishing…`);
      await this.doPublish(this.outDir);
    } catch (e) {
      this.setStatus("Bump failed: " + (e as Error).message);
    }
  }

  // Reaction B: delete the conflicting published version, then republish it.
  private async deleteAndRepublish(): Promise<void> {
    if (this.outDir === undefined || this.lastName === undefined || this.lastVersion === undefined) {
      this.setStatus("Compile first.");
      return;
    }
    this.setStatus(`Deleting ${this.lastName}@${this.lastVersion}…`);
    try {
      await this.registry.deleteVersion(this.lastName, this.lastVersion);
      await this.doPublish(this.outDir);
    } catch (e) {
      this.setStatus("Delete failed: " + (e as Error).message);
    }
  }

  // Reveal the two conflict-recovery buttons in the header (idempotent).
  private offerConflictActions(): void {
    this.header.ConflictVisible = true;
  }

  // Hide the conflict-recovery buttons once a publish succeeds.
  private clearConflictActions(): void {
    this.header.ConflictVisible = false;
  }
}
