import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { ProjectModelProvider } from "../../project-services/generators/project-model-provider.js";
import { NpmArtifacts } from "./npm-artifacts.js";

// Resolves the project's declared base bindings (metaModel + libraries) into base
// documents through the composite IPackageSource, and publishes them as ResolvedBases.
// An unresolvable binding is reported as an error diagnostic (which stops the pipeline).
// Delegates the resolve walk to ProjectModelProvider, the seam generators share.
export class ResolveBasesAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "resolve-bases";

    public readonly Name = ResolveBasesAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [NpmArtifacts.ResolvedBases];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const provider = new ProjectModelProvider(ctx.Project, ctx.Manifest, ctx.Source);
        const { bases, problems } = await provider.ResolveBases();
        if (problems.length > 0)
        {
            for (const problem of problems)
            {
                ctx.Diagnostics.Report({ severity: Severity.Error, message: problem, source: ResolveBasesAction.ActionName });
            }
            return;
        }
        ctx.Artifacts.Set(NpmArtifacts.ResolvedBases, bases);
    }
}
