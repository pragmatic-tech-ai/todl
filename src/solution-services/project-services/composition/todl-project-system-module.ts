/**
 * TODL's project-system module: the head of a host's `.modules:` block. Delegates
 * to `ProjectSystemComposer`, which seeds the registries + wires lifecycle, into
 * whatever `IServiceContainer` the host's `CompositionRoot` hands it. Targets
 * every host kind (it registers no view). Hand-written (not a `.mu` `.services:`
 * block) because seeding + event wiring are side effects `.services:` cannot
 * express.
 *
 * LISTABLE BY NAME: a `.mu` `.modules: { … }` entry is a bare identifier that lowers
 * to `AddModule(<identifier>)` — it passes the imported value as-is, never `new`s it.
 * So the CLASS itself also satisfies `IModule` through its static surface (`Targets`
 * + `RegisterServices`, which composes a fresh instance). `.modules: {
 * TodlProjectSystemModule }` therefore works with no app-side instance, and
 * `new TodlProjectSystemModule()` stays an ordinary instance module for code hosts.
 * `new this()` keeps the static path polymorphic, so a subclass (the node variant)
 * listed by name composes ITS override.
 *
 * BROWSER-SAFE (exported from the main barrel): registers everything EXCEPT the
 * node-bound html-bundle build system. A node host that wants html-bundle uses
 * `TodlNodeProjectSystemModule` from the `./project-system` subpath.
 */

import { type IModule, type IServiceContainer, HostKind } from "@pragmatic-tech-ai/todl-runtime";
import { ProjectSystemComposer } from "./project-system-composer.js";

export class TodlProjectSystemModule implements IModule
{
    // Empty ⇒ universal (every host kind) — mirrors `Module.Targets` (the lowering
    // of a plain `.mu` `module { }` block with no `.targets:` restriction).
    public static readonly Targets: ReadonlySet<HostKind> = new Set<HostKind>();

    public readonly Targets: ReadonlySet<HostKind> = TodlProjectSystemModule.Targets;

    // The class-as-module entry point (see header): composes a fresh instance of
    // whichever class it was called on.
    public static RegisterServices(container: IServiceContainer): void
    {
        new this().RegisterServices(container);
    }

    public RegisterServices(container: IServiceContainer): void
    {
        ProjectSystemComposer.Compose(container);
    }
}
