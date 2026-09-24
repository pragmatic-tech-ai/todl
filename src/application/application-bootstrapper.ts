import { CompositionRoot } from "@pragmatic-tech-ai/todl-runtime";
import type { ModelRegistry } from "../model-data/model-registry.js";
import type { IContributionSource } from "./contribution-source.js";
import { ModelRegistryContribution } from "./model-registry-contribution.js";
import { ApplicationEntryPoint } from "./application-entry-point.js";

// Composes a CompositionRoot (created plain when headless; a host passes its own)
// by applying each contribution in order, then returns the entry point.
export class ApplicationBootstrapper
{
    public static async Boot(
        sources: readonly IContributionSource[],
        root?: CompositionRoot,
    ): Promise<ApplicationEntryPoint>
    {
        const composed = root ?? new CompositionRoot();
        for (const source of sources)
        {
            await source.Contribute(composed);
        }
        return new ApplicationEntryPoint(composed);
    }

    // The common single-registry case the generated package's consumer calls.
    public static BootRegistry(
        registry: ModelRegistry,
        root?: CompositionRoot,
    ): Promise<ApplicationEntryPoint>
    {
        return ApplicationBootstrapper.Boot([new ModelRegistryContribution(registry)], root);
    }
}
