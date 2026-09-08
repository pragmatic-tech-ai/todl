import { Observable, ObservableCollection } from "@pragmatic-tech-ai/mural/runtime";
import { EditorLanguage } from "../../editor/monaco-editor-host.js";

/** The content a selectable leaf routes to the editor (undefined for branches). */
export interface LeafContent {
  text: string;
  language: EditorLanguage;
}

// One node in the Packages content tree, rendered data-driven by a
// HierarchicalDataTemplate[TreeNodeVM] (itemsselector = Children). This is the
// framework-native path: the TreeView generates containers from the bound
// ItemsSource, so rows realize (an imperatively-built TreeView hosted via
// ContentControl renders its chrome but never realizes item rows).
//
// A leaf has `Children === undefined` (the template treats undefined children as
// a leaf row) and carries `Content`. A branch has a `Children` collection. A
// lazy branch starts with a "Loading…" placeholder and runs `loader` the first
// time it expands (OnExpand — the framework's lazy-load hook), replacing the
// placeholder with the fetched children.
export class TreeNodeVM extends Observable {
  private loaded = false;

  private constructor(
    private readonly _header: string,
    private readonly _children: ObservableCollection<TreeNodeVM> | undefined,
    private readonly _content: LeafContent | undefined,
    private readonly loader: (() => Promise<TreeNodeVM[]>) | undefined,
  ) {
    super();
  }

  get Header(): string { return this._header; }
  get Children(): ObservableCollection<TreeNodeVM> | undefined { return this._children; }
  get Content(): LeafContent | undefined { return this._content; }

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

  /** A selectable leaf: `Content` set, no children. */
  static leaf(header: string, text: string, language: EditorLanguage): TreeNodeVM {
    return new TreeNodeVM(header, undefined, { text, language }, undefined);
  }

  /** An eagerly-populated branch. */
  static branch(header: string, children: readonly TreeNodeVM[]): TreeNodeVM {
    return new TreeNodeVM(header, new ObservableCollection<TreeNodeVM>([...children]), undefined, undefined);
  }

  /** A branch whose children are fetched the first time it expands. */
  static lazy(header: string, loader: () => Promise<TreeNodeVM[]>): TreeNodeVM {
    const children = new ObservableCollection<TreeNodeVM>([TreeNodeVM.leaf("Loading…", "", EditorLanguage.PlainText)]);
    return new TreeNodeVM(header, children, undefined, loader);
  }
}
