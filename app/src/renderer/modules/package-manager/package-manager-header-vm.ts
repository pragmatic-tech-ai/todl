import { Observable, RelayCommand, type ICommand } from "@pragmatic-tech-ai/mural/runtime";

// Header actions for the Package Manager side panel — presented in the pane
// header's Commands slot (ShellSideContentPane.Commands = ActiveService.
// HeaderCommands). A lightweight Observable so the refresh affordance renders
// through DataTemplate[PackageManagerHeaderVM] instead of a Visual built in code.
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
