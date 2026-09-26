/**
 * TODL's project-system module: the head of a host's `.modules:` block. Delegates
 * to `ProjectSystemComposer`, which seeds the registries + wires lifecycle, into
 * whatever `IServiceContainer` the host's `CompositionRoot` hands it. Targets
 * every host kind (it registers no view). Hand-written (not a `.mu` `.services:`
 * block) because seeding + event wiring are side effects `.services:` cannot
 * express.
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
    public readonly Targets: ReadonlySet<HostKind> = new Set<HostKind>();

    public RegisterServices(container: IServiceContainer): void
    {
        ProjectSystemComposer.Compose(container);
    }
}
