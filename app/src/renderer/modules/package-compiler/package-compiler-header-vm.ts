import { Observable, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";

// Handlers the compiler's header buttons invoke — supplied by the service, which
// owns the open/compile/publish flow. Passing callbacks (rather than the service
// itself) keeps this VM free of a back-reference to the service type.
export interface PackageCompilerHandlers {
  open(): void;
  compile(): void;
  publish(): void;
  bump(): void;
  delete(): void;
}

// Header actions for the Package Compiler side panel — presented in the pane
// header's Commands slot (ShellSideContentPane.Commands = ActiveService.
// HeaderCommands) as a button row rendered by DataTemplate[PackageCompilerHeaderVM].
//
// Open/Compile/Publish are always shown; Bump/Delete are the 409-conflict
// recovery choices, revealed (via ConflictVisible) only after a publish hits an
// existing version and hidden again once a publish succeeds.
export class PackageCompilerHeaderVM extends Observable {
  readonly Open: ICommand;
  readonly Compile: ICommand;
  readonly Publish: ICommand;
  readonly Bump: ICommand;
  readonly Delete: ICommand;

  // Reactive so the two conflict buttons bind their Visibility to it; toggled by
  // the service as publishes conflict / succeed.
  private _conflictVisible = false;
  get ConflictVisible(): boolean { return this._conflictVisible; }
  set ConflictVisible(v: boolean) {
    if (v === this._conflictVisible) return;
    const old = this._conflictVisible;
    this._conflictVisible = v;
    this.RaisePropertyChanged("ConflictVisible", old, v);
  }

  constructor(handlers: PackageCompilerHandlers) {
    super();
    this.Open = new RelayCommand(() => handlers.open(), undefined, {
      Text: "Open", Description: "Open a project directory to compile.",
    });
    this.Compile = new RelayCommand(() => handlers.compile(), undefined, {
      Text: "Compile", Description: "Compile the opened directory into a package.",
    });
    this.Publish = new RelayCommand(() => handlers.publish(), undefined, {
      Text: "Publish", Description: "Publish the compiled package to the registry.",
    });
    this.Bump = new RelayCommand(() => handlers.bump(), undefined, {
      Text: "Bump version", Description: "Bump to the next unused version, recompile, and republish.",
    });
    this.Delete = new RelayCommand(() => handlers.delete(), undefined, {
      Text: "Delete version", Description: "Delete the conflicting published version, then republish.",
    });
  }
}
