import {
  ServiceBase,
  MuralBase,
  MetaData,
  ObservableCollection,
  type IServiceProvider,
} from "@pragmatic-tech-ai/mural/runtime";
import { ContentHostService, type IActivatable } from "@pragmatic-tech-ai/mural/framework";
import { RegistryClient } from "../../services/registry/registry-client.js";
import { PackageItemVM } from "./package-item-vm.js";
import { PackageManagerHeaderVM } from "./package-manager-header-vm.js";
import { PackageViewVM } from "./package-view-vm.js";

// The Package Manager capability's backing service. Connects to the registry
// (via the shared RegistryClient) and exposes the package list as bindable
// state the side panel renders in a ListBox.
//
// A ServiceBase (bindable, MuralBase-backed) so the view binds $Packages /
// $Status / $SelectedPackage directly. Fetches lazily: OnActivated (the
// IActivatable hook the NavigationService calls when the capability becomes
// active) loads the list on first open; the header Refresh command reloads.
export class PackageManagerService extends ServiceBase implements IActivatable {
  static readonly PackagesKey = MuralBase.RegisterProperty<ObservableCollection<PackageItemVM>>(
    PackageManagerService, "Packages", undefined as unknown as ObservableCollection<PackageItemVM>, MetaData.None);
  static readonly SelectedPackageKey = MuralBase.RegisterProperty<PackageItemVM | undefined>(
    PackageManagerService, "SelectedPackage", undefined, MetaData.None);
  static readonly StatusKey = MuralBase.RegisterProperty<string>(
    PackageManagerService, "Status", "", MetaData.None);

  get Packages(): ObservableCollection<PackageItemVM> { return this.get_property_value(PackageManagerService.PackagesKey); }
  get SelectedPackage(): PackageItemVM | undefined { return this.get_property_value(PackageManagerService.SelectedPackageKey); }
  set SelectedPackage(v: PackageItemVM | undefined) { this.set_property_value(PackageManagerService.SelectedPackageKey, v); }
  get Status(): string { return this.get_property_value(PackageManagerService.StatusKey); }

  private readonly registry: RegistryClient;
  // The shell's central content host — View(x) swaps what the content region
  // shows (via the framework's reactive DataTemplate[ContentHostService]).
  private readonly contentHost: ContentHostService;
  // The current selection's central view; re-presented on re-activation.
  private currentView: PackageViewVM | undefined;
  // Guards the lazy first load so re-selecting the capability doesn't refetch;
  // the Refresh command bypasses it (it always reloads).
  private loaded = false;

  constructor(provider: IServiceProvider) {
    super(provider);
    this.registry = provider.getRequired(RegistryClient);
    this.contentHost = provider.getRequired(ContentHostService.Key);
    this.set_property_value(PackageManagerService.PackagesKey, new ObservableCollection<PackageItemVM>());
    // The pane header's Refresh affordance (rendered via DataTemplate).
    this.HeaderCommands = new PackageManagerHeaderVM(() => this.refresh());
    // Selecting a package (listbox SelectedItem binds two-way) swaps the central
    // content-host view to that package's PackageView.
    this.AddPropertyChangedListener(PackageManagerService.SelectedPackageKey, () => this.showSelected());
  }

  // Build the central view for the current selection (or clear it) and present
  // it in the shell's content host.
  private showSelected(): void {
    const sel = this.SelectedPackage;
    this.currentView = sel !== undefined ? new PackageViewVM(sel.Name, this.registry) : undefined;
    this.contentHost.View(this.currentView);
  }

  // IActivatable — the capability became active. Load the list once on first
  // open, and re-present this capability's current selection into the shared
  // content host (which may hold another capability's content after a switch).
  OnActivated(): void {
    if (!this.loaded) void this.load();
    this.contentHost.View(this.currentView);
  }

  // Reload on demand (the header Refresh command).
  refresh(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.set_property_value(PackageManagerService.StatusKey, "Loading…");
    try {
      const names = await this.registry.list();
      const items = this.Packages;
      items.Clear();
      for (const name of names) items.Add(new PackageItemVM(name));
      this.loaded = true;
      this.set_property_value(
        PackageManagerService.StatusKey,
        names.length === 0 ? "No packages in the registry." : "",
      );
    } catch (e) {
      this.set_property_value(
        PackageManagerService.StatusKey,
        "Could not reach the registry: " + (e as Error).message,
      );
    }
  }
}
