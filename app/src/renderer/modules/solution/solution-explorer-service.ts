import {
  ServiceBase,
  ObservableCollection,
  type IServiceProvider,
} from "@pragmatic-tech-ai/mural/runtime";
import { type IActivatable } from "@pragmatic-tech-ai/mural/framework";
import type { GridProperty, IPropertyBag } from "@pragmatic-tech-ai/mural/framework";
import {
  SolutionManagerService,
  SolutionSettingsRegistry,
  SolutionTreeVM,
  SolutionMemberNodeVM,
  SettingBagGrid,
} from "@pragmatic-tech-ai/todl";
import { RegistryClient } from "../../services/registry/registry-client.js";
import { AppStorageProviderRegistry } from "../../services/storage/storage-provider-registry.js";
import { NpmRegistryBag } from "./npm-registry-bag.js";
import { SolutionCommandsVM } from "./solution-commands-vm.js";

// The Solution Explorer capability's backing service (app-side presentation over
// the package's UI-agnostic SolutionManagerService). It:
//   • contributes the npm-registry cross-project setting bag;
//   • projects the active solution into bindable view state — a New/Open/Save
//     toolbar, the member/folder tree, and the setting-bag PropertyGrid.
// The manager's host seams are registered separately (SolutionSeamsRegistration,
// installed from the bootstrap) and resolved by the manager from the container.
export class SolutionExplorerService extends ServiceBase implements IActivatable {
  private _title = "No solution open";
  private _hasSolution = false;
  private _commands: SolutionCommandsVM = undefined as unknown as SolutionCommandsVM;
  private readonly _treeRoots = new ObservableCollection<SolutionMemberNodeVM>();
  private _settingsProperties: readonly GridProperty[] | undefined = undefined;
  private _settingsTarget: IPropertyBag | undefined = undefined;

  get Title(): string { return this._title; }
  get HasSolution(): boolean { return this._hasSolution; }
  get Commands(): SolutionCommandsVM { return this._commands; }
  get TreeRoots(): ObservableCollection<SolutionMemberNodeVM> { return this._treeRoots; }
  get SettingsProperties(): readonly GridProperty[] | undefined { return this._settingsProperties; }
  get SettingsTarget(): IPropertyBag | undefined { return this._settingsTarget; }

  private readonly manager: SolutionManagerService;
  private readonly settings: SolutionSettingsRegistry;
  private readonly storageRegistry: AppStorageProviderRegistry;
  private readonly registry: RegistryClient;
  private tree: SolutionTreeVM | undefined; // hold a ref so its VMs aren't GC'd

  constructor(provider: IServiceProvider) {
    super(provider);
    this.manager = provider.getRequired(SolutionManagerService.Key);
    this.settings = provider.getRequired(SolutionSettingsRegistry.Key);
    this.storageRegistry = provider.getRequired(AppStorageProviderRegistry.Key);
    this.registry = provider.getRequired(RegistryClient);

    const old = this._commands;
    this._commands = new SolutionCommandsVM({
      newSolution: () => void this.NewSolution(),
      openSolution: () => void this.OpenSolution(),
      save: () => void this.save(),
    });
    this.RaisePropertyChanged("Commands", old, this._commands);

    // The cross-project setting bags this app offers (npm-registry today).
    NpmRegistryBag.contribute(this.settings);

    // Re-project whenever the active solution changes.
    this.manager.PropertyChanged("ActiveSolution").subscribe(() => this.refresh());
  }

  OnActivated(): void { this.refresh(); }

  // Public so the Home welcome page can drive the same flows (New/Open) and then
  // navigate the user to this capability.
  public async NewSolution(): Promise<void> {
    const dir = await this.registry.pickDirectory();
    if (dir.length === 0) return; // canceled
    await this.manager.NewSolution(dir);
    this.bindBags();
    this.refresh();
  }

  public async OpenSolution(): Promise<void> {
    const dir = await this.registry.pickDirectory();
    if (dir.length === 0) return;
    await this.OpenSolutionAt(dir);
  }

  // Open a solution at a known folder (no picker) — used by the recent list.
  public async OpenSolutionAt(dir: string): Promise<void> {
    await this.manager.OpenSolution(dir);
    this.bindBags();
    this.refresh();
  }

  private async save(): Promise<void> {
    await this.manager.Save();
  }

  // Materialize the registered bag definitions onto the active session, so the
  // settings PropertyGrid has live bags to edit.
  private bindBags(): void {
    this.manager.ActiveSolution?.BindBags(this.settings.Definitions);
  }

  // Project the active solution into the bindable view state.
  private refresh(): void {
    const session = this.manager.ActiveSolution;
    this.setHasSolution(session !== undefined);
    this.setTitle(session === undefined ? "No solution open" : session.Name);

    const roots = this.TreeRoots;
    roots.Clear();
    this.tree = undefined;
    this.setSettingsProperties(undefined);
    this.setSettingsTarget(undefined);
    if (session === undefined) return;

    this.tree = new SolutionTreeVM(session, (member) =>
      this.storageRegistry.Create(
        AppStorageProviderRegistry.DefaultBackendId,
        SolutionExplorerService.joinOs(session.Storage.Root, member.Ref.path),
      ),
    );
    for (const node of this.tree.Roots) roots.Add(node);

    // The settings pane edits the first contributed bag (npm-registry today).
    const bag = session.SettingBags.ToArray()[0];
    if (bag !== undefined) {
      this.setSettingsProperties(SettingBagGrid.describe(bag));
      this.setSettingsTarget(SettingBagGrid.bagOf(bag));
    }
  }

  private setTitle(v: string): void {
    const old = this._title;
    this._title = v;
    this.RaisePropertyChanged("Title", old, v);
  }

  private setHasSolution(v: boolean): void {
    const old = this._hasSolution;
    this._hasSolution = v;
    this.RaisePropertyChanged("HasSolution", old, v);
  }

  private setSettingsProperties(v: readonly GridProperty[] | undefined): void {
    const old = this._settingsProperties;
    this._settingsProperties = v;
    this.RaisePropertyChanged("SettingsProperties", old, v);
  }

  private setSettingsTarget(v: IPropertyBag | undefined): void {
    const old = this._settingsTarget;
    this._settingsTarget = v;
    this.RaisePropertyChanged("SettingsTarget", old, v);
  }

  // Join a (possibly Windows) root folder with a relative POSIX member path
  // using the root's separator — mirrors AppLocalStorage's abs().
  private static joinOs(root: string, rel: string): string {
    const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
    const segments: string[] = [];
    for (const seg of rel.split(/[\\/]+/)) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") segments.pop();
      else segments.push(seg);
    }
    if (segments.length === 0) return root;
    const base = root.endsWith(sep) ? root.slice(0, -sep.length) : root;
    return base + sep + segments.join(sep);
  }
}
