import { MuralBase, MetaData } from "@pragmatic-tech-ai/mural/runtime";
import type { IDocument } from "@pragmatic-tech-ai/mural/framework";
import type { PackageSource } from "@pragmatic-tech-ai/todl/package-manager";
import type { CorpusEntry } from "@shared/corpus-types.js";
import { PlaygroundVM } from "./playground-vm.js";

let seq = 0;

/** A playground editor session as an IDocument, so it shows as a Content tab.
 *  It owns a PlaygroundVM; DataTemplate[PlaygroundDocument] binds $VM. Read-only
 *  w.r.t. the shell's dirty/save model (the editor is a scratch surface), so it
 *  never gates close/quit. */
export class PlaygroundDocument extends MuralBase implements IDocument {
  static readonly IdKey = MuralBase.RegisterProperty<string>(PlaygroundDocument, "Id", "", MetaData.None);
  static readonly TitleKey = MuralBase.RegisterProperty<string>(PlaygroundDocument, "Title", "Playground", MetaData.None);
  static readonly VMKey = MuralBase.RegisterProperty<PlaygroundVM>(PlaygroundDocument, "VM", undefined as unknown as PlaygroundVM, MetaData.None);

  get Id(): string { return this.get_property_value(PlaygroundDocument.IdKey); }
  get Title(): string { return this.get_property_value(PlaygroundDocument.TitleKey); }
  get VM(): PlaygroundVM { return this.get_property_value(PlaygroundDocument.VMKey); }
  get IsDirty(): boolean { return false; }
  Save(): void { /* scratch surface — nothing to persist */ }

  private constructor(id: string, title: string, vm: PlaygroundVM) {
    super();
    this.set_property_value(PlaygroundDocument.IdKey, id);
    this.set_property_value(PlaygroundDocument.TitleKey, title);
    this.set_property_value(PlaygroundDocument.VMKey, vm);
  }

  static blank(): PlaygroundDocument {
    return new PlaygroundDocument(`playground:${++seq}`, "Playground", new PlaygroundVM());
  }
  static forExample(entry: CorpusEntry): PlaygroundDocument {
    const vm = new PlaygroundVM();
    vm.load(entry);
    return new PlaygroundDocument(`playground:${++seq}`, entry.manifest.title, vm);
  }
  static forSources(sources: PackageSource[]): PlaygroundDocument {
    const vm = new PlaygroundVM();
    vm.loadSource(sources);
    return new PlaygroundDocument(`playground:${++seq}`, "Sources", vm);
  }
}
