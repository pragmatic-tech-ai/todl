import { Application, type ApplicationInitOptions } from "@pragmatic-tech-ai/mural";
import { Material, MaterialLight, MaterialDark } from "@pragmatic-tech-ai/mural/resources/material";
import type { ModelRegistry } from "../model-data/model-registry.js";
import { ApplicationBootstrapper } from "./application-bootstrapper.js";
import type { ApplicationEntryPoint } from "./application-entry-point.js";
import { ModelRegistryContribution } from "./model-registry-contribution.js";
import { MuralViewContribution } from "./mural-view-contribution.js";

// Runs a compiled TODL application in a Mural Application: activates the Material
// theme (so control constructors resolve themed default styles), then composes the
// data + view contributions into a fresh Application, returned ready to mount
// (caller: app.initialize(target)). Tests pass a fixed scheme; the browser default
// picks light/dark from the OS via autoScheme.
export class MuralHost
{
    private static readonly DefaultTheme: ApplicationInitOptions =
    {
        theme: Material,
        autoScheme: { light: MaterialLight, dark: MaterialDark },
    };

    public static async Run(
        registry: ModelRegistry,
        themeOptions: ApplicationInitOptions = MuralHost.DefaultTheme,
    ): Promise<{ app: Application; entry: ApplicationEntryPoint }>
    {
        const app = new Application();
        app.initialize(themeOptions);
        const entry = await ApplicationBootstrapper.Boot(
            [new ModelRegistryContribution(registry), new MuralViewContribution()],
            app,
        );
        return { app, entry };
    }
}
