import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import type { ProjectBaseModelBindings } from "../../project-services/core/base-binding.js";
import { NpmArtifacts } from "../npm/npm-artifacts.js";
import { BundleClosureCollector } from "./bundle-closure-collector.js";

// Collects the architecture's closure as the inlined package set for the page,
// deps-first over the build source, and publishes it as BundlePackages. An
// unresolvable base is an error diagnostic (stops the pipeline).
export class CollectBundlePackagesAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "collect-bundle-packages";
    private static readonly NoModelMessage = "no compiled model to bundle";

    public readonly Name = CollectBundlePackagesAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [NpmArtifacts.BundlePackages, NpmArtifacts.BundleResources];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const compiled = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (compiled === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: CollectBundlePackagesAction.NoModelMessage, source: CollectBundlePackagesAction.ActionName });
            return;
        }
        const manifest = ctx.Manifest;
        const bindings: ProjectBaseModelBindings = {
            ...(manifest.metaModels !== undefined ? { metaModels: manifest.metaModels } : {}),
            ...(manifest.libraries !== undefined ? { libraries: manifest.libraries } : {}),
            ...(manifest.architectures !== undefined ? { architectures: manifest.architectures } : {}),
        };
        const { packages, problems, resources } = await BundleClosureCollector.Collect(ctx.Source, bindings, compiled);
        if (problems.length > 0)
        {
            for (const problem of problems) ctx.Diagnostics.Report({ severity: Severity.Error, message: problem, source: CollectBundlePackagesAction.ActionName });
            return;
        }
        ctx.Artifacts.Set(NpmArtifacts.BundlePackages, packages);
        ctx.Artifacts.Set(NpmArtifacts.BundleResources, resources);
    }
}
