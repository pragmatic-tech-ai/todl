import { Observable } from "@pragmatic-tech-ai/mural/runtime";
import { RegistryClient } from "../../services/registry/registry-client.js";

// The central content view for a selected package — its dependency header plus
// its authored source files. Rendered by DataTemplate[PackageViewVM] in the
// shell's content host. Fetches on construction (getPackage for the dependency
// list, getSources for the files) and raises change notifications as the async
// results land (Name is fixed at construction, so it needs none).
//
// The source files are exposed as ONE concatenated text string (each file under
// a `// === path ===` header), not a per-item collection: type-dispatched item
// templates don't resolve at this nesting depth (shell → ContentHostService →
// PackageView), whereas a single-level $binding to a string does.
export class PackageViewVM extends Observable {
  private readonly _name: string;
  private _dependencies = "";
  private _status = "Loading…";
  private _sourcesText = "";

  constructor(name: string, registry: RegistryClient) {
    super();
    this._name = name;
    void this.load(registry);
  }

  get Name(): string { return this._name; }
  get Dependencies(): string { return this._dependencies; }
  get Status(): string { return this._status; }
  get SourcesText(): string { return this._sourcesText; }

  private setDependencies(v: string): void {
    const old = this._dependencies;
    if (old === v) return;
    this._dependencies = v;
    this.RaisePropertyChanged("Dependencies", old, v);
  }

  private setStatus(v: string): void {
    const old = this._status;
    if (old === v) return;
    this._status = v;
    this.RaisePropertyChanged("Status", old, v);
  }

  private setSourcesText(v: string): void {
    const old = this._sourcesText;
    if (old === v) return;
    this._sourcesText = v;
    this.RaisePropertyChanged("SourcesText", old, v);
  }

  private async load(registry: RegistryClient): Promise<void> {
    try {
      const [pkg, sources] = await Promise.all([
        registry.getPackage({ name: this._name }),
        registry.getSources({ name: this._name }),
      ]);
      this.setDependencies(
        pkg.dependencies.length > 0
          ? "Dependencies: " + pkg.dependencies.join(", ")
          : "No dependencies",
      );
      this.setSourcesText(
        sources.map((s) => "// === " + s.name + " ===\n" + s.text).join("\n\n"),
      );
      this.setStatus(sources.length === 0 ? "No source files." : "");
    } catch (e) {
      this.setStatus("Could not load package: " + (e as Error).message);
    }
  }
}
