import { MuralBase, MetaData, RelayCommand, Visibility, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { RegistryClient } from "../../services/registry-client.js";
import { PackageItemVM } from "./package-item-vm.js";
import { PackageDetailVM } from "./package-detail-vm.js";

/** The Packages page: master list of registry package names + a detail pane, with
 *  a token settings affordance shown until the main process reports a token. */
export class PackagesVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(PackagesVM, "Title", "Packages", MetaData.None);
  static ItemsKey = MuralBase.RegisterProperty<PackageItemVM[]>(PackagesVM, "Items", [], MetaData.None);
  static SelectedKey = MuralBase.RegisterProperty<PackageItemVM | undefined>(PackagesVM, "Selected", undefined, MetaData.None);
  static DetailKey = MuralBase.RegisterProperty<PackageDetailVM | undefined>(PackagesVM, "Detail", undefined, MetaData.None);
  static SettingsVisibilityKey = MuralBase.RegisterProperty<Visibility>(PackagesVM, "SettingsVisibility", Visibility.Collapsed, MetaData.None);
  static StatusMessageKey = MuralBase.RegisterProperty<string>(PackagesVM, "StatusMessage", "", MetaData.None);
  static ConfigureKey = MuralBase.RegisterProperty<ICommand | undefined>(PackagesVM, "Configure", undefined, MetaData.None);

  get Title(): string { return this.get_property_value(PackagesVM.TitleKey); }
  get Items(): PackageItemVM[] { return this.get_property_value(PackagesVM.ItemsKey); }
  get SettingsVisibility(): Visibility { return this.get_property_value(PackagesVM.SettingsVisibilityKey); }
  get StatusMessage(): string { return this.get_property_value(PackagesVM.StatusMessageKey); }
  get Configure(): ICommand | undefined { return this.get_property_value(PackagesVM.ConfigureKey); }

  private scope = "@pragmatic-tech-ai";

  constructor(
    private readonly client: RegistryClient,
    private readonly onOpen: (name: string) => void,
    private readonly onConfigure: () => void,
  ) {
    super();
    this.set_property_value(PackagesVM.ConfigureKey, new RelayCommand(() => this.onConfigure()));
    // Selecting a row builds + loads its detail pane.
    this.AddPropertyChangedListener(PackagesVM.SelectedKey, () => {
      const sel = this.get_property_value(PackagesVM.SelectedKey);
      if (!sel) return;
      const detail = new PackageDetailVM(this.client, this.scope, this.onOpen);
      this.set_property_value(PackagesVM.DetailKey, detail);
      void detail.load(sel.name);
    });
  }

  /** (Re)load token state + the package list. Called when the page is shown. */
  async load(): Promise<void> {
    const config = await this.client.getConfig();
    this.scope = config.scope;
    this.set_property_value(PackagesVM.SettingsVisibilityKey, config.hasToken ? Visibility.Collapsed : Visibility.Visible);
    if (!config.hasToken) {
      this.set_property_value(PackagesVM.StatusMessageKey, "No token configured — open Setup to add one.");
      this.set_property_value(PackagesVM.ItemsKey, []);
      return;
    }
    try {
      const names = await this.client.list();
      const items = names.map((n) => new PackageItemVM(n));
      this.set_property_value(PackagesVM.ItemsKey, items);
      this.set_property_value(PackagesVM.StatusMessageKey, names.length === 0 ? "No packages found." : "");
      // Stamp each row's kind badge from its manifest (cheap packument read).
      void Promise.all(items.map(async (it) => it.setKind(await this.client.getMeta(it.name))));
    } catch (err) {
      this.set_property_value(PackagesVM.StatusMessageKey, `Failed to list packages: ${(err as Error).message}`);
    }
  }
}
