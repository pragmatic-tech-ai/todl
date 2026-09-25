import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { fromJSON } from "../../../compiler-services/emit/json.js";
import { generateReadClient } from "../../../codegen/read-client.js";
import { NpmArtifacts } from "../npm/npm-artifacts.js";
import { HtmlArtifacts } from "./html-artifacts.js";

// The first producer of the per-project html-bundle app pipeline (spec §per-project-app-build,
// task 1): reflects the compiled model's full closure into a Repository and generates a typed
// read-client DTO source from it — a project content generator (persistent, not sandbox), so
// the app project's own generated/model.ts stays under source control alongside the .todl.
export class GenerateModelDtoAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "generate-model-dto";
    private static readonly OutputFile = "generated/model.ts";
    private static readonly RuntimeImportSpecifier = "@pragmatic-tech-ai/todl";
    private static readonly NoCompiledModelMessage = "no compiled model to generate a DTO from";

    public readonly Name = GenerateModelDtoAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [HtmlArtifacts.GeneratedDto];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const pkg = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (pkg === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: GenerateModelDtoAction.NoCompiledModelMessage, source: GenerateModelDtoAction.ActionName });
            return;
        }

        const repo = fromJSON(pkg.fullDocument);
        const name = ctx.Manifest.id ?? ctx.Manifest.name;
        const src = generateReadClient(repo, { name, importSpecifier: GenerateModelDtoAction.RuntimeImportSpecifier });
        await ctx.Project.WriteText(GenerateModelDtoAction.OutputFile, src);
        ctx.Artifacts.Set(HtmlArtifacts.GeneratedDto, GenerateModelDtoAction.OutputFile);
    }
}
