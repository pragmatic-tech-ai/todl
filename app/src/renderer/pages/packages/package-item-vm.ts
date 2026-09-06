import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";

/** One master-list row: the bare package name (kind lives in the detail pane,
 *  since it requires fetching the package). */
export class PackageItemVM extends MuralBase {
  static NameKey = MuralBase.RegisterProperty<string>(PackageItemVM, "Name", "", MetaData.None);
  static KindKey = MuralBase.RegisterProperty<string>(PackageItemVM, "Kind", "", MetaData.None);

  get Name(): string {
    return this.get_property_value(PackageItemVM.NameKey);
  }
  get Kind(): string {
    return this.get_property_value(PackageItemVM.KindKey);
  }
  setKind(kind: string): void {
    this.set_property_value(PackageItemVM.KindKey, kind);
  }

  readonly name: string;

  constructor(name: string) {
    super();
    this.name = name;
    this.set_property_value(PackageItemVM.NameKey, name);
  }
}
