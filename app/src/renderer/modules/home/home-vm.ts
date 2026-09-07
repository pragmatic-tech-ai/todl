import { Observable } from "@pragmatic-tech-ai/mural/runtime";

// The Home capability's backing service — a placeholder view model for the
// bare shell scaffold. It carries only display strings for the side panel;
// real capabilities replace it with their own service + DataTemplate.
//
// A lightweight Observable (the app's VM root), not MuralBase: it holds no
// dependency properties, just read-only display state the side-panel template
// binds to. Constructed by the service container with the provider, which a
// dependency-free placeholder accepts and ignores.
export class HomeVM extends Observable {
  constructor(_provider?: unknown) {
    super();
  }

  get Title(): string { return "Home"; }

  get Message(): string {
    return "The shell is up. Add modules to contribute capabilities to the rail.";
  }
}
