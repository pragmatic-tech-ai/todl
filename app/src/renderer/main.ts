// Renderer bootstrap — a thin entry (mural convention: bootstraps stay thin).
// `app` is the initialized Application compiled from app.mu; handing it an
// HtmlTarget mounts the ViewerShell (rail + side panel) into #app.
// @ts-expect-error compiled by vitePluginMural
import { app } from "./app.mu";
import { HtmlTarget } from "@pragmatic-tech-ai/mural/visual-engine";
import { NavigationService, ContentHostService, DialogService } from "@pragmatic-tech-ai/mural/framework";
import { SolutionServicesRegistration } from "./modules/solution/solution-services.js";

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

// The shell's central content host — the region a capability drives via
// View(x). Registered at the root under ContentHostService.Key so the shell's
// `$service(ContentHostService)` and the capabilities resolve the same instance.
app.Services.register(ContentHostService.Key, (p) => new ContentHostService(p));

// The modal-dialog service — EditorShell auto-registers + hosts this, but this
// app runs a ViewerShell, so register it at the root (like the services above)
// and hand it the shell root as its overlay anchor after the tree mounts.
app.Services.register(DialogService.Key, (p) => new DialogService(p));

// The host services the package's SolutionManagerService resolves from the
// container (by key) — registered here, before initialize, so the manager finds
// them whenever it is first constructed. The solution module owns the concrete
// wiring; this only installs it at the composition root.
SolutionServicesRegistration.Register(app.Services);

await document.fonts.ready;
app.initialize(new HtmlTarget(document.getElementById("app")!));

// SetHost after initialize so the shell root Visual (the dialog's overlay anchor)
// exists. DialogService owns no Visual; it reaches the overlay layer through this.
const shellRoot = app.Resources.Root;
if (shellRoot !== undefined) app.Services.get(DialogService.Key)?.SetHost(shellRoot);
