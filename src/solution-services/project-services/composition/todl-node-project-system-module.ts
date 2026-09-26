/**
 * The NODE-ONLY variant of `TodlProjectSystemModule` for a node host with an app
 * `.modules:` block (devUI main, a headless mural host): identical to the browser-safe
 * module, plus the html-bundle build system (esbuild + node fs), via
 * `NodeProjectSystemComposer`. A renderer/browser host uses `TodlProjectSystemModule`
 * from the main barrel instead.
 */

import { type IServiceContainer } from "@pragmatic-tech-ai/todl-runtime";
import { TodlProjectSystemModule } from "./todl-project-system-module.js";
import { NodeProjectSystemComposer } from "./node-project-system-composer.js";

export class TodlNodeProjectSystemModule extends TodlProjectSystemModule
{
    public override RegisterServices(container: IServiceContainer): void
    {
        NodeProjectSystemComposer.Compose(container);
    }
}
