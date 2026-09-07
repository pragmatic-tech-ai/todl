import { Observable, type IServiceProvider } from "@pragmatic-tech-ai/mural/runtime";
import { ContentHostService, type IActivatable } from "@pragmatic-tech-ai/mural/framework";

// The Home capability's backing service — a placeholder view model for the
// bare shell scaffold. It carries only display strings for the side panel;
// real capabilities replace it with their own service + DataTemplate.
//
// A lightweight Observable (the app's VM root), not MuralBase: it holds no
// dependency properties, just read-only display state the side-panel template
// binds to. Implements IActivatable to clear the shared central content host on
// activation (Home has no central view, so it shouldn't show a lingering one
// from another capability).
export class HomeVM extends Observable implements IActivatable {
  private readonly contentHost: ContentHostService;

  constructor(provider: IServiceProvider) {
    super();
    this.contentHost = provider.getRequired(ContentHostService.Key);
  }

  OnActivated(): void {
    this.contentHost.View(undefined);
  }

  get Title(): string { return "Home"; }

  get Message(): string {
    return "The shell is up. Add modules to contribute capabilities to the rail.";
  }
}
