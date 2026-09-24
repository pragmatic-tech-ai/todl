import { Application, type Visual } from "@pragmatic-tech-ai/mural";
import type { CompositionRoot } from "@pragmatic-tech-ai/todl-runtime";
import { ModelRegistry } from "../model-data/model-registry.js";
import type { ModelDataSource } from "../model-data/model-data-source.js";
import type { IContributionSource } from "./contribution-source.js";
import { ModelBrowserView } from "./model-browser-view.js";

// Contributes the application's UI: builds the default (or supplied) view from the
// booted registry's root model and installs it as the Mural Application's root visual.
// Runs after ModelRegistryContribution (the registry must already be in the provider).
export class MuralViewContribution implements IContributionSource
{
    private static readonly NotAMuralHostMessage =
        "MuralViewContribution requires a Mural Application as the composition root.";

    constructor(private readonly build: (root: ModelDataSource | undefined) => Visual = ModelBrowserView.Build)
    {
    }

    public Contribute(root: CompositionRoot): void
    {
        if (!(root instanceof Application))
        {
            throw new Error(MuralViewContribution.NotAMuralHostMessage);
        }
        const registry = root.Provider.getRequired(ModelRegistry.ServiceKey);
        root.Resources.Root = this.build(registry.Root());
    }
}
