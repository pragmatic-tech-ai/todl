import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { ProjectModelProvider } from "../../project-services/generators/project-model-provider.js";
import { NpmArtifacts } from "./npm-artifacts.js";

// Compiles the project's .todl sources against the resolved bases (the pure
// compilePackage), recording the declared deps on the own-only document, and publishes
// the CompiledPackage. Compile errors are reported as diagnostics (stopping the pipeline).
// Delegates the compile to ProjectModelProvider, the seam generators share.
export class CompileModelAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "compile-model";

    public readonly Name = CompileModelAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.ResolvedBases];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const bases = ctx.Artifacts.Get(NpmArtifacts.ResolvedBases) ?? [];
        const provider = new ProjectModelProvider(ctx.Project, ctx.Manifest, ctx.Source);
        // A publishable project (meta-model / library) compiles with its real package
        // identity, which model.json carries into the published artifact. A consumer
        // project (architecture) has no publishable id — the publishable compile throws
        // "has no id to publish" — and never publishes anyway, so it compiles with the
        // synthetic-local identity (symbols are identical). Without this, building an
        // architecture app (html-bundle) died at compile-model.
        const hasPublishableId = ctx.Manifest.id !== undefined && ctx.Manifest.id.length > 0;
        const result = hasPublishableId
            ? await provider.CompileWithBases(bases)
            : await provider.CompileLocalWithBases(bases);
        if (result.package === undefined)
        {
            for (const error of result.errors)
            {
                ctx.Diagnostics.Report({ severity: Severity.Error, message: error, source: CompileModelAction.ActionName });
            }
            return;
        }
        ctx.Artifacts.Set(NpmArtifacts.CompiledModel, result.package);
    }
}
