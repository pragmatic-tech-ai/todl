import { Application, type Visual } from "@pragmatic-tech-ai/mural";
import type { ModelRegistry } from "../model-data/model-registry.js";
import type { ModelDataSource } from "../model-data/model-data-source.js";
import { ApplicationBootstrapper } from "./application-bootstrapper.js";
import type { ApplicationEntryPoint } from "./application-entry-point.js";
import { ModelRegistryContribution } from "./model-registry-contribution.js";
import { MuralViewContribution } from "./mural-view-contribution.js";
import { ModelBrowserView } from "./model-browser-view.js";

// Runs a compiled TODL application in a Mural Application: composes data + view
// contributions into a fresh Application and returns it ready to mount
// (caller: app.initialize(target)). viewFactory defaults to the model browser.
export class MuralHost
{
    public static async Run(
        registry: ModelRegistry,
        viewFactory?: (root: ModelDataSource | undefined) => Visual,
    ): Promise<{ app: Application; entry: ApplicationEntryPoint }>
    {
        const app = new Application();
        const entry = await ApplicationBootstrapper.Boot(
            [
                new ModelRegistryContribution(registry),
                new MuralViewContribution(viewFactory ?? ModelBrowserView.Build),
            ],
            app,
        );
        return { app, entry };
    }
}
