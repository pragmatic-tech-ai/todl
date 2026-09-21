import type { IBuildAction, BuildActionContext } from "../build-action.js";
import type { ArtifactKey } from "../artifact-key.js";
import { Severity } from "../diagnostic-sink.js";
import { RecursiveProjectReferencesResolver } from "../../project-services/core/base-resolver.js";
import type { ProjectBaseModelBindings } from "../../project-services/core/base-binding.js";
import { NpmArtifacts } from "./npm-artifacts.js";

// Resolves the project's declared base bindings (metaModel + libraries) into base
// documents through the composite IPackageSource, and publishes them as ResolvedBases.
// An unresolvable binding is reported as an error diagnostic (which stops the pipeline).
export class ResolveBasesAction implements IBuildAction
{
    private static readonly ActionName = "resolve-bases";

    public readonly Name = ResolveBasesAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [NpmArtifacts.ResolvedBases];

    public async Execute(ctx: BuildActionContext): Promise<void>
    {
        const manifest = ctx.Manifest;
        const bindings: ProjectBaseModelBindings = {
            ...(manifest.metaModels !== undefined ? { metaModels: manifest.metaModels } : {}),
            ...(manifest.libraries !== undefined ? { libraries: manifest.libraries } : {}),
        };
        const { bases, problems } = await RecursiveProjectReferencesResolver.Resolve(ctx.Source, bindings);
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
