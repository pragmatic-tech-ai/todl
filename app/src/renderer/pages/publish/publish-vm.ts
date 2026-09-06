import { MuralBase, MetaData, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { RegistryClient } from "../../services/registry-client.js";

/** The Publish page: choose a local project dir and publish it to the registry. */
export class PublishVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(PublishVM, "Title", "Publish", MetaData.None);
  static DirKey = MuralBase.RegisterProperty<string>(PublishVM, "Dir", "", MetaData.None);
  static StatusKey = MuralBase.RegisterProperty<string>(PublishVM, "Status", "", MetaData.None);
  static ChooseKey = MuralBase.RegisterProperty<ICommand | undefined>(PublishVM, "Choose", undefined, MetaData.None);
  static PublishKey = MuralBase.RegisterProperty<ICommand | undefined>(PublishVM, "Publish", undefined, MetaData.None);

  get Title(): string { return this.get_property_value(PublishVM.TitleKey); }
  get Dir(): string { return this.get_property_value(PublishVM.DirKey); }
  get Status(): string { return this.get_property_value(PublishVM.StatusKey); }
  get Choose(): ICommand | undefined { return this.get_property_value(PublishVM.ChooseKey); }
  get Publish(): ICommand | undefined { return this.get_property_value(PublishVM.PublishKey); }

  constructor(private readonly client: RegistryClient) {
    super();
    this.set_property_value(PublishVM.ChooseKey, new RelayCommand(() => void this.choose()));
    this.set_property_value(PublishVM.PublishKey, new RelayCommand(() => void this.publish()));
  }

  private async choose(): Promise<void> {
    const dir = await this.client.pickDirectory();
    if (dir) this.set_property_value(PublishVM.DirKey, dir);
  }

  private async publish(): Promise<void> {
    if (!this.Dir) {
      this.set_property_value(PublishVM.StatusKey, "Choose a directory first.");
      return;
    }
    this.set_property_value(PublishVM.StatusKey, `Publishing ${this.Dir}…`);
    try {
      await this.client.publishDir(this.Dir);
      this.set_property_value(PublishVM.StatusKey, `Published ${this.Dir} ✓`);
    } catch (err) {
      this.set_property_value(PublishVM.StatusKey, `Publish failed: ${(err as Error).message}`);
    }
  }
}
