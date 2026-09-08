import { Observable } from "@pragmatic-tech-ai/mural/runtime";
import { MonacoEditorHost, EditorLanguage } from "../../editor/monaco-editor-host.js";

// The central content-host pane for the Packages capability — a single editable
// Monaco editor, shared across selections. Selecting a content node in the side
// tree calls `show(text, language)`, which switches the editor's language in
// place and swaps its buffer (edits are local scratch — not persisted). Owning
// ONE editor (rather than a fresh one per selection) avoids Monaco churn and is
// presented directly via `ContentControl [ Content = $Editor ]`.
export class EditorPaneVM extends Observable {
  private readonly editor = new MonacoEditorHost();

  constructor() {
    super();
    this.editor.Language = EditorLanguage.PlainText;
    this.editor.Text = "Select a node in the tree to view its content.";
  }

  /** The editable editor element, presented in the template. */
  get Editor(): MonacoEditorHost { return this.editor; }

  /** Show `text` in the editor under `language` (Language before Text so the
   *  model's language is set before the new buffer lands). */
  show(text: string, language: EditorLanguage): void {
    this.editor.Language = language;
    this.editor.Text = text;
  }
}
