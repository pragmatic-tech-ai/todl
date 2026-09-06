import { MuralBase, MetaData, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";
import type { RegistryClient } from "../../services/registry-client.js";
import type { VersionList, InstalledPackage, ResolvedClosure } from "@pragmatic-tech-ai/todl/package-manager";

/** The detail pane for one package: metadata, resolved closure, compiled content,
 *  and Open-in-Playground. Facets are preformatted strings, filled by `load`. */
export class PackageDetailVM extends MuralBase {
  static TitleKey = MuralBase.RegisterProperty<string>(PackageDetailVM, "Title", "", MetaData.None);
  static KindKey = MuralBase.RegisterProperty<string>(PackageDetailVM, "Kind", "", MetaData.None);
  static VersionKey = MuralBase.RegisterProperty<string>(PackageDetailVM, "Version", "", MetaData.None);
  static DistTagsKey = MuralBase.RegisterProperty<string>(PackageDetailVM, "DistTags", "", MetaData.None);
  static DependenciesKey = MuralBase.RegisterProperty<string>(PackageDetailVM, "Dependencies", "", MetaData.None);
  static ClosureKey = MuralBase.RegisterProperty<string>(PackageDetailVM, "Closure", "", MetaData.None);
  static ContentKey = MuralBase.RegisterProperty<string>(PackageDetailVM, "Content", "", MetaData.None);
  static OpenKey = MuralBase.RegisterProperty<ICommand | undefined>(PackageDetailVM, "Open", undefined, MetaData.None);

  get Title(): string { return this.get_property_value(PackageDetailVM.TitleKey); }
  get Kind(): string { return this.get_property_value(PackageDetailVM.KindKey); }
  get Version(): string { return this.get_property_value(PackageDetailVM.VersionKey); }
  get DistTags(): string { return this.get_property_value(PackageDetailVM.DistTagsKey); }
  get Dependencies(): string { return this.get_property_value(PackageDetailVM.DependenciesKey); }
  get Closure(): string { return this.get_property_value(PackageDetailVM.ClosureKey); }
  get Content(): string { return this.get_property_value(PackageDetailVM.ContentKey); }
  get Open(): ICommand | undefined { return this.get_property_value(PackageDetailVM.OpenKey); }

  private currentName = "";

  constructor(
    private readonly client: RegistryClient,
    private readonly scope: string,
    private readonly onOpen: (name: string) => void,
  ) {
    super();
    this.set_property_value(PackageDetailVM.OpenKey, new RelayCommand(() => this.onOpen(this.currentName)));
  }

  async load(name: string): Promise<void> {
    this.currentName = name;
    this.set_property_value(PackageDetailVM.TitleKey, name);
    const scoped = `${this.scope}/${name}`;

    const versions: VersionList = await this.client.versions(name);
    const latest = versions.distTags["latest"] ?? versions.versions[versions.versions.length - 1] ?? "—";
    this.set_property_value(PackageDetailVM.VersionKey, latest);
    this.set_property_value(
      PackageDetailVM.DistTagsKey,
      Object.entries(versions.distTags).map(([tag, v]) => `${tag} → ${v}`).join(", ") || "—",
    );

    const pkg: InstalledPackage = await this.client.getPackage({ name });
    this.set_property_value(PackageDetailVM.KindKey, pkg.meta.kind);
    this.set_property_value(
      PackageDetailVM.DependenciesKey,
      pkg.dependencies.length > 0 ? pkg.dependencies.join(", ") : "none",
    );
    const nodes = pkg.document.nodes?.length ?? 0;
    const edges = pkg.document.edges?.length ?? 0;
    this.set_property_value(PackageDetailVM.ContentKey, `${nodes} nodes · ${edges} edges`);

    const closure: ResolvedClosure = await this.client.resolveClosure([scoped]);
    this.set_property_value(PackageDetailVM.ClosureKey, closure.order.join("  →  "));
  }
}
