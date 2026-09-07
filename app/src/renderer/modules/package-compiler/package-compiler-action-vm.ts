import { Observable } from "@pragmatic-tech-ai/mural/runtime";

// The actions the Package Compiler capability offers. Interactive buttons don't
// receive input in the pane body in this build, but ListBox rows do — so the
// actions are presented as a ListBox and each row is one of these.
export enum CompilerAction {
  Open,
  Compile,
  Publish,
}

// One row in the compiler's action list.
export class PackageCompilerActionVM extends Observable {
  constructor(private readonly _name: string, readonly Kind: CompilerAction) {
    super();
  }

  get Name(): string {
    return this._name;
  }
}
