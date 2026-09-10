import { Observable, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";

// One row in the Home welcome's "Recent solutions" list: the folder path plus an
// Open command that reopens it (delegated back to the Home page). Kept as its own
// VM so the list template can bind $Path + $Open per item.
export class RecentSolutionVM extends Observable {
  readonly Path: string;
  readonly Open: ICommand;

  constructor(path: string, open: (path: string) => void) {
    super();
    this.Path = path;
    this.Open = new RelayCommand(() => open(path), undefined, { Text: path });
  }
}
