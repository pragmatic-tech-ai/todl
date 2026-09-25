/**
 * Produces `generated/app.mu`, the default application-UI markup for the
 * project's compiled model closure. Lifts the rendering logic out of
 * `GenerateAppUiAction` (todl-build-system/html-bundle) into a project content
 * generator: written once at project creation via WritePolicy.WriteOnce, after
 * which the user owns the file — no clobber guard needed, unlike the build
 * action's marker check, because WriteOnce never touches an existing file.
 */

import { fromJSON } from "../../../compiler-services/emit/json.js";
import { AppUiTemplate } from "../../todl-build-system/html-bundle/app-ui-template.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { WritePolicy } from "./project-content-generator.js";
import { WritePolicyWriter } from "./write-policy-writer.js";
import { GeneratorTrigger, type IProjectContentGenerator, type GeneratorContext, type GeneratorResult } from "./project-content-generator.js";

export class UiPlaceholderGenerator implements IProjectContentGenerator
{
    private static readonly GeneratorId = "app-ui";
    private static readonly Display = "App UI";
    private static readonly OutputFile = "generated/app.mu";
    private static readonly NoModelMessage = "no compiled model to generate an app UI from";

    public readonly Id = UiPlaceholderGenerator.GeneratorId;
    public readonly DisplayName = UiPlaceholderGenerator.Display;
    public readonly Produces: readonly string[] = [UiPlaceholderGenerator.OutputFile];
    public readonly Triggers: readonly GeneratorTrigger[] = [GeneratorTrigger.ProjectCreated];
    public readonly WritePolicy = WritePolicy.WriteOnce;

    public async Generate(ctx: GeneratorContext): Promise<GeneratorResult>
    {
        const model = await ctx.Model.Compile();
        if (model.package === undefined)
        {
            this.ReportErrors(ctx, model.errors);
            return { Written: [], Skipped: [] };
        }

        const repo = fromJSON(model.package.fullDocument);
        const markup = AppUiTemplate.Render(repo);
        const wrote = await WritePolicyWriter.Write(ctx.Project, UiPlaceholderGenerator.OutputFile, markup, this.WritePolicy);
        return wrote ? { Written: [UiPlaceholderGenerator.OutputFile], Skipped: [] } : { Written: [], Skipped: [UiPlaceholderGenerator.OutputFile] };
    }

    private ReportErrors(ctx: GeneratorContext, errors: readonly string[]): void
    {
        const messages = errors.length > 0 ? errors : [UiPlaceholderGenerator.NoModelMessage];
        for (const message of messages)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message, source: UiPlaceholderGenerator.GeneratorId });
        }
    }
}
