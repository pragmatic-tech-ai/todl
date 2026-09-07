import { Observable } from "@pragmatic-tech-ai/mural/runtime";
import { formatText } from "@pragmatic-tech-ai/todl/language-service";
import { RegistryClient } from "../../services/registry/registry-client.js";
import { MonacoEditorHost } from "../../editor/monaco-editor-host.js";

// The central content view for a selected package — its dependency header plus
// its authored source files. Rendered by DataTemplate[PackageViewVM] in the
// shell's content host. Fetches on construction (getPackage for the dependency
// list, getSources for the files) and raises change notifications as the async
// results land (Name is fixed at construction, so it needs none).
//
// The source files render in an editable TODL Monaco editor (`Editor`), not a
// TextBlock: TextBlock is NoWrap single-line and collapses the newlines between
// files. The editor honours newlines, colours the TODL grammar, and is editable
// (local scratch — edits are not persisted back). Each file is run through the
// TODL formatter (`formatText`) so its indentation is normalised, then the files
// are concatenated under `// === path ===` headers into the editor's buffer.
export class PackageViewVM extends Observable {
  private readonly _name: string;
  private _dependencies = "";
  private _status = "Loading…";
  private readonly editor = new MonacoEditorHost();

  constructor(name: string, registry: RegistryClient) {
    super();
    this._name = name;
    void this.load(registry);
  }

  get Name(): string { return this._name; }
  get Dependencies(): string { return this._dependencies; }
  get Status(): string { return this._status; }
  /** The editable TODL source editor, presented directly in the template. */
  get Editor(): MonacoEditorHost { return this.editor; }

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
      this.editor.Text = sources
        .map((s) => "// === " + s.name + " ===\n" + formatText(s.text))
        .join("\n\n");
      this.setStatus(sources.length === 0 ? "No source files." : "");
    } catch (e) {
      this.setStatus("Could not load package: " + (e as Error).message);
    }
  }
}
