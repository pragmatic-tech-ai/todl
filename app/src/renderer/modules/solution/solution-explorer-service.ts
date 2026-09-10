import {
  ServiceBase,
  MuralBase,
  MetaData,
  ObservableCollection,
  type IServiceProvider,
} from "@pragmatic-tech-ai/mural/runtime";
import { DialogService, type IActivatable } from "@pragmatic-tech-ai/mural/framework";
import type { GridProperty, IPropertyBag } from "@pragmatic-tech-ai/mural/framework";
import {
  SolutionManagerService,
  SolutionSettingsRegistry,
  SolutionTreeVM,
  SolutionMemberNodeVM,
  SettingBagGrid,
} from "@pragmatic-tech-ai/todl";
import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { RegistryClient } from "../../services/registry/registry-client.js";
import { AppStorageProviderRegistry } from "../../services/storage/storage-provider-registry.js";
import { ConfirmDialog } from "../../services/dialogs/confirm-dialog.js";
import { TodlPackageProjectFactory, TODL_PACKAGE_TYPE } from "./todl-package-project-factory.js";
import { NpmRegistryBag } from "./npm-registry-bag.js";
import { SolutionCommandsVM } from "./solution-commands-vm.js";

// The Solution Explorer capability's backing service (app-side presentation over
// the package's UI-agnostic SolutionManagerService). It:
//   • configures the manager's host seams (local storage backend, project
//     factory map, discard-confirm dialog) — done here, where the peers resolve,
//     so the renderer bootstrap (main.ts) stays thin;
//   • contributes the npm-registry cross-project setting bag;
//   • projects the active solution into bindable view state — a New/Open/Save
//     toolbar, the member/folder tree, and the setting-bag PropertyGrid.
export class SolutionExplorerService extends ServiceBase implements IActivatable {
  static readonly TitleKey = MuralBase.RegisterProperty<string>(
    SolutionExplorerService, "Title", "No solution open", MetaData.None);
  static readonly HasSolutionKey = MuralBase.RegisterProperty<boolean>(
    SolutionExplorerService, "HasSolution", false, MetaData.None);
  static readonly CommandsKey = MuralBase.RegisterProperty<SolutionCommandsVM>(
    SolutionExplorerService, "Commands", undefined as unknown as SolutionCommandsVM, MetaData.None);
  static readonly TreeRootsKey = MuralBase.RegisterProperty<ObservableCollection<SolutionMemberNodeVM>>(
    SolutionExplorerService, "TreeRoots", undefined as unknown as ObservableCollection<SolutionMemberNodeVM>, MetaData.None);
  static readonly SettingsPropertiesKey = MuralBase.RegisterProperty<readonly GridProperty[] | undefined>(
    SolutionExplorerService, "SettingsProperties", undefined, MetaData.None);
  static readonly SettingsTargetKey = MuralBase.RegisterProperty<IPropertyBag | undefined>(
    SolutionExplorerService, "SettingsTarget", undefined, MetaData.None);

  get Title(): string { return this.get_property_value(SolutionExplorerService.TitleKey); }
  get HasSolution(): boolean { return this.get_property_value(SolutionExplorerService.HasSolutionKey); }
  get Commands(): SolutionCommandsVM { return this.get_property_value(SolutionExplorerService.CommandsKey); }
  get TreeRoots(): ObservableCollection<SolutionMemberNodeVM> { return this.get_property_value(SolutionExplorerService.TreeRootsKey); }
  get SettingsProperties(): readonly GridProperty[] | undefined { return this.get_property_value(SolutionExplorerService.SettingsPropertiesKey); }
  get SettingsTarget(): IPropertyBag | undefined { return this.get_property_value(SolutionExplorerService.SettingsTargetKey); }

  private readonly manager: SolutionManagerService;
  private readonly settings: SolutionSettingsRegistry;
  private readonly storageRegistry: AppStorageProviderRegistry;
  private readonly registry: RegistryClient;
  private readonly dialogs: DialogService;
  private readonly factory = new TodlPackageProjectFactory();
  private tree: SolutionTreeVM | undefined; // hold a ref so its VMs aren't GC'd

  constructor(provider: IServiceProvider) {
    super(provider);
    this.manager = provider.getRequired(SolutionManagerService.Key);
    this.settings = provider.getRequired(SolutionSettingsRegistry.Key);
    this.storageRegistry = provider.getRequired(AppStorageProviderRegistry.Key);
    this.registry = provider.getRequired(RegistryClient);
    this.dialogs = provider.getRequired(DialogService.Key);

    this.set_property_value(SolutionExplorerService.TreeRootsKey, new ObservableCollection<SolutionMemberNodeVM>());
    this.set_property_value(
      SolutionExplorerService.CommandsKey,
      new SolutionCommandsVM({
        newSolution: () => void this.newSolution(),
        openSolution: () => void this.openSolution(),
        save: () => void this.save(),
      }),
    );

    // The cross-project setting bags this app offers (npm-registry today).
    NpmRegistryBag.contribute(this.settings);

    // Install the host seams the manager needs.
    this.manager.Configure({
      storageForFolder: (folder) => this.storageRegistry.Create(AppStorageProviderRegistry.DefaultBackendId, folder),
      factoryFor: (type) => (type === TODL_PACKAGE_TYPE ? this.factory : undefined),
      confirmDiscard: () =>
        ConfirmDialog.show(this.dialogs, {
          title: "Discard changes?",
          message: "The current solution has unsaved changes. Discard them?",
          confirmLabel: "Discard",
        }),
    });

    // Re-project whenever the active solution changes.
    this.manager.AddPropertyChangedListener("ActiveSolution", () => this.refresh());
  }

  OnActivated(): void { this.refresh(); }

  private async newSolution(): Promise<void> {
    const dir = await this.registry.pickDirectory();
    if (dir.length === 0) return; // canceled
    await this.manager.NewSolution(dir);
    this.bindBags();
    this.refresh();
  }

  private async openSolution(): Promise<void> {
    const dir = await this.registry.pickDirectory();
    if (dir.length === 0) return;
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
    this.set_property_value(SolutionExplorerService.HasSolutionKey, session !== undefined);
    this.set_property_value(SolutionExplorerService.TitleKey, session === undefined ? "No solution open" : session.Name);

    const roots = this.TreeRoots;
    roots.Clear();
    this.tree = undefined;
    this.set_property_value(SolutionExplorerService.SettingsPropertiesKey, undefined);
    this.set_property_value(SolutionExplorerService.SettingsTargetKey, undefined);
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
      this.set_property_value(SolutionExplorerService.SettingsPropertiesKey, SettingBagGrid.describe(bag));
      this.set_property_value(SolutionExplorerService.SettingsTargetKey, SettingBagGrid.bagOf(bag));
    }
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
