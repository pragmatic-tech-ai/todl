import type { CompositionRoot } from "@pragmatic-tech-ai/todl-runtime";
import { ModelRegistry } from "../model-data/model-registry.js";
import type { IContributionSource } from "./contribution-source.js";

// The data contribution: prepare every model's data (against the root's provider,
// so a future connector could resolve credentials there), then register the
// registry under its well-known token. Preparation precedes registration so a
// resolved registry is always ready to read.
export class ModelRegistryContribution implements IContributionSource
{
    constructor(private readonly registry: ModelRegistry)
    {
    }

    public async Contribute(root: CompositionRoot): Promise<void>
    {
        await this.registry.PrepareAll(root.Provider);
        root.Provider.registerInstance(ModelRegistry.ServiceKey, this.registry);
    }
}
