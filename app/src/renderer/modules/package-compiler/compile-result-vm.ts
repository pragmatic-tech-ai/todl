import { Observable } from "@pragmatic-tech-ai/mural/runtime";
import type { CompileResultView } from "../../../main/registry/registry-bridge.js";

// The central content view for a compiled directory — the resulting
// CompiledPackage's identity, the files written, and any diagnostics. Rendered
// by DataTemplate[CompileResultVM] in the shell's content host.
//
// Immutable (built from one compile result), so plain getters need no change
// notification. Everything is exposed as flattened text (single-level bindings):
// type-dispatched item templates don't resolve at this nesting depth.
export class CompileResultVM extends Observable {
  constructor(private readonly result: CompileResultView) {
    super();
  }

  get Title(): string {
    const id = this.result.name ?? "(unnamed package)";
    return this.result.version !== undefined ? `${id}@${this.result.version}` : id;
  }

  get Summary(): string {
    if (!this.result.ok) return "Compile failed.";
    const files = this.result.files.length;
    const sources = this.result.sourceCount ?? 0;
    return `Compiled ${sources} source file(s) → ${files} package file(s) in ${this.result.outDir}`;
  }

  get FilesText(): string {
    return this.result.files.join("\n");
  }

  get DiagnosticsText(): string {
    if (this.result.diagnostics.length === 0) return "No diagnostics.";
    return this.result.diagnostics.map((d) => `${d.severity}: ${d.message}`).join("\n");
  }
}
