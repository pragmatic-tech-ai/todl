import { Observable, ObservableCollection } from "@pragmatic-tech-ai/mural/runtime";

// One node in the compiler side-pane's opened-folder tree, rendered data-driven
// by a HierarchicalDataTemplate[FolderNodeVM] (itemsselector = Children). The
// tree is read-only orientation — a leaf (a file) carries no content and does
// nothing when selected; a directory is a lazy branch whose children are read
// the first time it expands (OnExpand — the framework's lazy-load hook).
//
// A file has `Children === undefined` (the template treats undefined children as
// a leaf row). A directory starts with a "Loading…" placeholder and runs
// `loader` on first expand, swapping the placeholder for the real entries.
export class FolderNodeVM extends Observable {
  private loaded = false;

  private constructor(
    private readonly _header: string,
    private readonly _children: ObservableCollection<FolderNodeVM> | undefined,
    private readonly loader: (() => Promise<FolderNodeVM[]>) | undefined,
  ) {
    super();
  }

  get Header(): string { return this._header; }
  get Children(): ObservableCollection<FolderNodeVM> | undefined { return this._children; }

  /** Lazy-load hook — the TreeView calls this on each transition to expanded.
   *  Runs the loader once, swapping the placeholder for the real children. */
  OnExpand(): void {
    if (this.loader === undefined || this._children === undefined || this.loaded) return;
    this.loaded = true; // one-shot
    void this.loader().then((nodes) => {
      this._children!.Clear();
      for (const n of nodes) this._children!.Add(n);
    });
  }

  /** A file leaf: no children, inert. */
  static file(name: string): FolderNodeVM {
    return new FolderNodeVM(name, undefined, undefined);
  }

  /** A directory branch whose entries are read the first time it expands. */
  static dir(name: string, loader: () => Promise<FolderNodeVM[]>): FolderNodeVM {
    const children = new ObservableCollection<FolderNodeVM>([FolderNodeVM.file("Loading…")]);
    return new FolderNodeVM(name, children, loader);
  }
}
