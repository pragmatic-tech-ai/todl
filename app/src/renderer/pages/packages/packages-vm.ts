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
  static TokenInputKey = MuralBase.RegisterProperty<string>(PackagesVM, "TokenInput", "", MetaData.None);
  static SettingsVisibilityKey = MuralBase.RegisterProperty<Visibility>(PackagesVM, "SettingsVisibility", Visibility.Collapsed, MetaData.None);
  static StatusMessageKey = MuralBase.RegisterProperty<string>(PackagesVM, "StatusMessage", "", MetaData.None);
  static SetTokenKey = MuralBase.RegisterProperty<ICommand | undefined>(PackagesVM, "SetToken", undefined, MetaData.None);

  get Title(): string { return this.get_property_value(PackagesVM.TitleKey); }
  get Items(): PackageItemVM[] { return this.get_property_value(PackagesVM.ItemsKey); }
  get TokenInput(): string { return this.get_property_value(PackagesVM.TokenInputKey); }
  get SettingsVisibility(): Visibility { return this.get_property_value(PackagesVM.SettingsVisibilityKey); }
  get StatusMessage(): string { return this.get_property_value(PackagesVM.StatusMessageKey); }
  get SetToken(): ICommand | undefined { return this.get_property_value(PackagesVM.SetTokenKey); }

  private scope = "@pragmatic-tech-ai";

  constructor(
    private readonly client: RegistryClient,
    private readonly onOpen: (name: string) => void,
  ) {
    super();
    this.set_property_value(PackagesVM.SetTokenKey, new RelayCommand(() => void this.applyToken()));
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
      this.set_property_value(PackagesVM.StatusMessageKey, "Set a GitHub Packages token to browse packages.");
      this.set_property_value(PackagesVM.ItemsKey, []);
      return;
    }
    try {
      const names = await this.client.list();
      this.set_property_value(PackagesVM.ItemsKey, names.map((n) => new PackageItemVM(n)));
      this.set_property_value(PackagesVM.StatusMessageKey, names.length === 0 ? "No packages found." : "");
    } catch (err) {
      this.set_property_value(PackagesVM.StatusMessageKey, `Failed to list packages: ${(err as Error).message}`);
    }
  }

  private async applyToken(): Promise<void> {
    await this.client.setToken(this.TokenInput);
    this.set_property_value(PackagesVM.TokenInputKey, "");
    await this.load();
  }
}
