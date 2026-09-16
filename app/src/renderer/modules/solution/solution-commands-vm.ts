import { Observable, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";

// Handlers the Solution side-pane toolbar invokes — supplied by the explorer
// service, which owns the new/open/save flow. Passing callbacks (not the
// service) keeps this VM free of a back-reference to the service type (the
// PackageCompilerHeaderVM precedent).
export interface SolutionCommandHandlers {
  newSolution(): void;
  openSolution(): void;
  save(): void;
  compose(): void;
}

// Toolbar actions for the Solution Explorer side panel — a button row rendered
// by DataTemplate[SolutionCommandsVM].
export class SolutionCommandsVM extends Observable {
  readonly New: ICommand;
  readonly Open: ICommand;
  readonly Save: ICommand;
  readonly Compose: ICommand;

  constructor(handlers: SolutionCommandHandlers) {
    super();
    this.New = new RelayCommand(() => handlers.newSolution(), undefined, {
      Text: "New", Description: "Create a new empty solution in a folder.",
    });
    this.Open = new RelayCommand(() => handlers.openSolution(), undefined, {
      Text: "Open", Description: "Open an existing solution folder.",
    });
    this.Save = new RelayCommand(() => handlers.save(), undefined, {
      Text: "Save", Description: "Save the active solution to solution.json.",
    });
    this.Compose = new RelayCommand(() => handlers.compose(), undefined, {
      Text: "Compose", Description: "Compile all members and validate the composed cross-project graph.",
    });
  }
}
