// Stages a runnable per-model package (<id>.package.generated.ts) from a compiled
// application Repository. CompiledPackage carries only a serialized document, not a live
// Repository; the action therefore re-derives the Repository with checkAgainst using
// byte-identical inputs to how CompileModelAction produced the artifact.
import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { NpmArtifacts } from "../npm/npm-artifacts.js";
import { TodlProjectSourceFiles } from "../../project-services/core/todl-sources.js";
import { checkAgainst } from "../../../compiler-services/api.js";
import { ModelPackageGenerator } from "../../../codegen/model-package.js";

export class GenerateModelPackageAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "generate-model-package";
    private static readonly OutputSuffix = ".package.generated.ts";
    private static readonly NoCompiledModelMessage = "no compiled model to generate a package from";

    public readonly Name = GenerateModelPackageAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel, NpmArtifacts.ResolvedBases];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const compiled = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (compiled === undefined)
        {
            ctx.Diagnostics.Report({
                severity: Severity.Error,
                message: GenerateModelPackageAction.NoCompiledModelMessage,
                source: GenerateModelPackageAction.ActionName,
            });
            return;
        }

        const bases = ctx.Artifacts.Get(NpmArtifacts.ResolvedBases) ?? [];
        const sources = await TodlProjectSourceFiles.Collect(ctx.Project);
        const { model } = checkAgainst([...bases], [...sources]);

        let source: string;
        try
        {
            source = ModelPackageGenerator.Generate(model, { name: compiled.id });
        }
        catch (error)
        {
            ctx.Diagnostics.Report({
                severity: Severity.Error,
                message: (error as Error).message,
                source: GenerateModelPackageAction.ActionName,
            });
            return;
        }

        await ctx.Sandbox.WriteText(`${compiled.id}${GenerateModelPackageAction.OutputSuffix}`, source);
    }
}
