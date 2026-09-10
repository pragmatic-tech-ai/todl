import { Observable, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";

// Commands for the Package Manager side panel — presented as a local ToolBar
// pinned atop the pane body (rendered by DataTemplate[PackageManagerHeaderVM],
// bound via the service's Commands property). A lightweight Observable so the
// refresh affordance renders through the template instead of a Visual built in
// code.
export class PackageManagerHeaderVM extends Observable {
  readonly Refresh: ICommand;

  constructor(onRefresh: () => void) {
    super();
    this.Refresh = new RelayCommand(onRefresh, undefined, {
      Text: "Refresh",
      Description: "Reload the package list from the registry.",
    });
  }
}
