import { Observable, RelayCommand, ObservableCollection, type ICommand, type IServiceProvider } from "@pragmatic-tech-ai/mural/runtime";
import { NavigationService, ContentHostService, type IActivatable } from "@pragmatic-tech-ai/mural/framework";
import { SolutionManagerService } from "@pragmatic-tech-ai/todl";
import { SolutionExplorerService } from "../solution/solution-explorer-service.js";
import { RecentSolutionVM } from "./recent-solution-vm.js";

// The Home capability's backing service — the app's welcome/landing page. It is
// the first rail item, so it is what the shell shows on startup. Rather than the
// old bare-scaffold placeholder, it offers the primary entry points to the
// workspace: New Solution / Open Solution, and a list of recent solutions. Each
// action drives the real SolutionExplorerService flow and then navigates the
// user to the Solutions capability so they see the result.
//
// A lightweight Observable (the app's VM root), not MuralBase.
export class HomeVM extends Observable implements IActivatable {
  readonly New: ICommand;
  readonly Open: ICommand;
  readonly Recent = new ObservableCollection<RecentSolutionVM>();

  private readonly provider: IServiceProvider;

  // Resolve NOTHING here that can re-enter: HomeVM is constructed *during*
  // NavigationService's own factory (PopulateFromModules → auto-select Home →
  // syncActiveService → new HomeVM), so `getRequired(NavigationService.Key)` in
  // the constructor would re-invoke the not-yet-cached nav factory and recurse
  // forever. All peers are resolved lazily, after construction has returned.
  constructor(provider: IServiceProvider) {
    super();
    this.provider = provider;
    this.New = new RelayCommand(() => void this.newSolution(), undefined, {
      Text: "New Solution", Description: "Create a new empty solution in a folder.",
    });
    this.Open = new RelayCommand(() => void this.openSolution(), undefined, {
      Text: "Open Solution", Description: "Open an existing solution folder.",
    });
  }

  get Title(): string { return "Welcome to TODL"; }

  get Message(): string {
    return "Create or open a solution to group your projects and share settings (like the npm registry) across them.";
  }

  // Home has no central view; clear any lingering content and refresh the recent
  // list from the manager whenever this page is shown.
  OnActivated(): void {
    this.provider.getRequired(ContentHostService.Key).View(undefined);
    this.rebuildRecent();
  }

  private async newSolution(): Promise<void> {
    this.goToSolutions();
    await this.explorer().NewSolution();
  }

  private async openSolution(): Promise<void> {
    this.goToSolutions();
    await this.explorer().OpenSolution();
  }

  private async openRecent(path: string): Promise<void> {
    this.goToSolutions();
    await this.explorer().OpenSolutionAt(path);
  }

  private rebuildRecent(): void {
    this.Recent.Clear();
    for (const path of this.provider.getRequired(SolutionManagerService.Key).RecentSolutions) {
      this.Recent.Add(new RecentSolutionVM(path, (p) => void this.openRecent(p)));
    }
  }

  // Resolving the explorer constructs it (contributing the setting bag), so
  // New/Open work even before the Solutions rail item has been visited. The
  // manager's host seams are installed at the bootstrap, independent of this.
  private explorer(): SolutionExplorerService {
    return this.provider.getRequired(SolutionExplorerService);
  }

  // Switch the shell's active capability to Solutions by selecting the rail item
  // whose capability names the SolutionExplorerService.
  private goToSolutions(): void {
    const nav = this.provider.getRequired(NavigationService.Key);
    for (const item of nav.Items) {
      const cap = (item as { Capability?: { ServiceKey?: unknown } }).Capability;
      if (cap?.ServiceKey === SolutionExplorerService) {
        nav.SelectedItem = item;
        return;
      }
    }
  }
}
