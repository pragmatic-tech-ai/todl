// Renderer bootstrap — a thin entry (mural convention: bootstraps stay thin).
// `app` is the initialized Application compiled from app.mu; handing it an
// HtmlTarget mounts the ViewerShell (rail + side panel) into #app.
// @ts-expect-error compiled by vitePluginMural
import { app } from "./app.mu";
import { HtmlTarget } from "@pragmatic-tech-ai/mural/visual-engine";
import { NavigationService } from "@pragmatic-tech-ai/mural/framework";

// ViewerShell (unlike EditorShell) does not register a NavigationService, so
// the app supplies one at the root. Registered under NavigationService.Key so
// the shell's `$service(NavigationService)` resolves up-chain to this single
// instance. Its factory flattens the modules' capabilities into the rail and
// auto-selects the first (PopulateFromModules), so the side panel opens showing
// content. Registered BEFORE initialize; the lazy factory runs when the rail
// first binds, by which point the modules are composed.
app.Services.register(NavigationService.Key, (p) => {
  const nav = new NavigationService(p);
  nav.PopulateFromModules();
  return nav;
});

await document.fonts.ready;
app.initialize(new HtmlTarget(document.getElementById("app")!));
