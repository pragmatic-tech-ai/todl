import type { CompositionRoot, ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { ModelRegistry } from "../model-data/model-registry.js";
import type { ModelDataSource } from "../model-data/model-data-source.js";

// A thin read facade over a composed CompositionRoot: the composed services, the
// application's ModelRegistry (resolved through the well-known token), and Root()
// — the running application's entry point (the root model's ModelDataSource).
export class ApplicationEntryPoint
{
    private static readonly NoRegistryMessage =
        "ApplicationEntryPoint has no ModelRegistry; boot the application with a ModelRegistryContribution.";

    constructor(private readonly root: CompositionRoot)
    {
    }

    public get Services(): ServiceProvider
    {
        return this.root.Provider;
    }

    public Registry(): ModelRegistry
    {
        const registry = this.root.Provider.get(ModelRegistry.ServiceKey);
        if (registry === undefined)
        {
            throw new Error(ApplicationEntryPoint.NoRegistryMessage);
        }
        return registry;
    }

    public Root(): ModelDataSource | undefined
    {
        return this.Registry().Root();
    }
}
