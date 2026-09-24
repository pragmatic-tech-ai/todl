import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import type { ProjectBaseModelBindings } from "../../project-services/core/base-binding.js";
import { NpmArtifacts } from "../npm/npm-artifacts.js";
import { BundleClosureCollector } from "./bundle-closure-collector.js";

// Walks the architecture's base closure deps-first over the build source and publishes
// every package's resource bytes as BundleResources for the page to inline. The model
// data itself is carried by the compiled closure (CompiledModel.fullDocument), so this
// action no longer builds a package set. An unresolvable base is an error diagnostic.
export class CollectBundleResourcesAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "collect-bundle-resources";
    private static readonly NoModelMessage = "no compiled model to bundle";

    public readonly Name = CollectBundleResourcesAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [NpmArtifacts.BundleResources];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const compiled = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (compiled === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: CollectBundleResourcesAction.NoModelMessage, source: CollectBundleResourcesAction.ActionName });
            return;
        }
        const manifest = ctx.Manifest;
        const bindings: ProjectBaseModelBindings = {
            ...(manifest.metaModels !== undefined ? { metaModels: manifest.metaModels } : {}),
            ...(manifest.libraries !== undefined ? { libraries: manifest.libraries } : {}),
            ...(manifest.architectures !== undefined ? { architectures: manifest.architectures } : {}),
        };
        const { problems, resources } = await BundleClosureCollector.Collect(ctx.Source, bindings, compiled);
        if (problems.length > 0)
        {
            for (const problem of problems) ctx.Diagnostics.Report({ severity: Severity.Error, message: problem, source: CollectBundleResourcesAction.ActionName });
            return;
        }
        ctx.Artifacts.Set(NpmArtifacts.BundleResources, resources);
    }
}
