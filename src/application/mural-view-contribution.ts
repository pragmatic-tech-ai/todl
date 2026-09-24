import { Application } from "@pragmatic-tech-ai/mural";
import type { Observable } from "@pragmatic-tech-ai/mural/runtime";
import type { CompositionRoot } from "@pragmatic-tech-ai/todl-runtime";
import { ModelRegistry } from "../model-data/model-registry.js";
import type { ModelDataSource } from "../model-data/model-data-source.js";
import type { IContributionSource } from "./contribution-source.js";
import { ModelBrowserVM } from "./model-browser-vm.js";
import { ModelBrowserResources } from "./model-browser.mu.js";

// Contributes the application's UI: clones the themed model-browser resource
// dictionary, merges its DataTemplates into the Application's resources, installs its
// x:root Border as the root visual, and binds a ModelBrowserVM built from the booted
// registry's root model. Runs after ModelRegistryContribution and after the theme is
// active (MuralHost.Run activates it before Boot), so the cloned controls are themed.
export class MuralViewContribution implements IContributionSource
{
    private static readonly NotAMuralHostMessage =
        "MuralViewContribution requires a Mural Application as the composition root.";

    constructor(private readonly vm: (root: ModelDataSource | undefined) => Observable = ModelBrowserVM.For)
    {
    }

    public Contribute(root: CompositionRoot): void
    {
        if (!(root instanceof Application))
        {
            throw new Error(MuralViewContribution.NotAMuralHostMessage);
        }
        const registry = root.Provider.getRequired(ModelRegistry.ServiceKey);
        const dict = ModelBrowserResources.Clone();
        for (const [key, value] of dict.Entries())
        {
            root.Resources.Set(key, value);
        }
        root.Resources.Root = dict.Root;
        root.DataContext = this.vm(registry.Root());
    }
}
