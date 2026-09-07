import {
  ServiceBase,
  MuralBase,
  MetaData,
  ObservableCollection,
  type IServiceProvider,
} from "@pragmatic-tech-ai/mural/runtime";
import type { IActivatable } from "@pragmatic-tech-ai/mural/framework";
import { RegistryClient } from "../../services/registry/registry-client.js";
import { PackageItemVM } from "./package-item-vm.js";
import { PackageManagerHeaderVM } from "./package-manager-header-vm.js";

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
  // Guards the lazy first load so re-selecting the capability doesn't refetch;
  // the Refresh command bypasses it (it always reloads).
  private loaded = false;

  constructor(provider: IServiceProvider) {
    super(provider);
    this.registry = provider.getRequired(RegistryClient);
    this.set_property_value(PackageManagerService.PackagesKey, new ObservableCollection<PackageItemVM>());
    // The pane header's Refresh affordance (rendered via DataTemplate).
    this.HeaderCommands = new PackageManagerHeaderVM(() => this.refresh());
  }

  // IActivatable — the capability became active. Load once on first open.
  OnActivated(): void {
    if (!this.loaded) void this.load();
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
