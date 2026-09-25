import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { fromJSON } from "../../../compiler-services/emit/json.js";
import { NpmArtifacts } from "../npm/npm-artifacts.js";
import { AppUiTemplate } from "./app-ui-template.js";

// The default application-UI producer of the per-project html-bundle app pipeline
// (spec §per-project-app-build, task 2): reflects the compiled model into a
// Repository and renders `generated/app.mu` — one bound entity list per concept —
// via AppUiTemplate. Sibling of GenerateModelDtoAction; a project content
// generator (persistent), so the app project's own generated/app.mu stays under
// source control alongside the .todl. This is where "how entities are shown" now
// lives, moved out of the host.
export class GenerateAppUiAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "generate-app-ui";
    private static readonly OutputFile = "generated/app.mu";
    private static readonly NoCompiledModelMessage = "no compiled model to generate an app UI from";
    private static readonly HandAuthoredMessage =
        "generated/app.mu already exists without the generated marker (hand-authored) — leaving it in place";

    public readonly Name = GenerateAppUiAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const pkg = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (pkg === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: GenerateAppUiAction.NoCompiledModelMessage, source: GenerateAppUiAction.ActionName });
            return;
        }

        if (await this.IsHandAuthored(ctx))
        {
            ctx.Diagnostics.Report({ severity: Severity.Warning, message: GenerateAppUiAction.HandAuthoredMessage, source: GenerateAppUiAction.ActionName });
            return;
        }

        const repo = fromJSON(pkg.fullDocument);
        const markup = AppUiTemplate.Render(repo);
        await ctx.Project.WriteText(GenerateAppUiAction.OutputFile, markup);
    }

    // Clobber guard: a pre-existing generated/app.mu is only safe to overwrite when
    // its first line is the marker AppUiTemplate always emits. Anything else means a
    // developer edited the generated file by hand — skip the write and report it
    // rather than discarding their changes.
    private async IsHandAuthored(ctx: TodlBuildContext): Promise<boolean>
    {
        if (!(await ctx.Project.Exists(GenerateAppUiAction.OutputFile))) return false;
        const existing = await ctx.Project.ReadText(GenerateAppUiAction.OutputFile);
        const firstLine = existing.split("\n")[0];
        return firstLine !== AppUiTemplate.GeneratedMarker;
    }
}
