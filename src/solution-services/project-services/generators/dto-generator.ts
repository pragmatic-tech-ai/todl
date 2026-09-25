/**
 * Produces `generated/model.ts`, a typed read-client DTO reflecting the project's
 * compiled model closure. Lifts the generation logic out of
 * `GenerateModelDtoAction` (todl-build-system/html-bundle) into a project content
 * generator, so the app project's own generated/model.ts stays under source
 * control alongside the .todl, independent of any one build pipeline.
 */

import { fromJSON } from "../../../compiler-services/emit/json.js";
import { generateReadClient } from "../../../codegen/read-client.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { WritePolicy } from "./project-content-generator.js";
import { WritePolicyWriter } from "./write-policy-writer.js";
import { GeneratorTrigger, type IProjectContentGenerator, type GeneratorContext, type GeneratorResult } from "./project-content-generator.js";

export class DtoGenerator implements IProjectContentGenerator
{
    private static readonly GeneratorId = "model-dto";
    private static readonly Display = "Model DTO";
    private static readonly OutputFile = "generated/model.ts";
    private static readonly RuntimeImportSpecifier = "@pragmatic-tech-ai/todl";
    private static readonly NoModelMessage = "no compiled model to generate a DTO from";

    public readonly Id = DtoGenerator.GeneratorId;
    public readonly DisplayName = DtoGenerator.Display;
    public readonly Produces: readonly string[] = [DtoGenerator.OutputFile];
    public readonly Triggers: readonly GeneratorTrigger[] = [GeneratorTrigger.ProjectCreated, GeneratorTrigger.ReferencesChanged];
    public readonly WritePolicy = WritePolicy.Overwrite;

    public async Generate(ctx: GeneratorContext): Promise<GeneratorResult>
    {
        const model = await ctx.Model.Compile();
        if (model.package === undefined)
        {
            this.ReportErrors(ctx, model.errors);
            return { Written: [], Skipped: [] };
        }

        const repo = fromJSON(model.package.fullDocument);
        const name = ctx.Manifest.id ?? ctx.Manifest.name;
        const src = generateReadClient(repo, { name, importSpecifier: DtoGenerator.RuntimeImportSpecifier });
        const wrote = await WritePolicyWriter.Write(ctx.Project, DtoGenerator.OutputFile, src, WritePolicy.Overwrite);
        return wrote ? { Written: [DtoGenerator.OutputFile], Skipped: [] } : { Written: [], Skipped: [DtoGenerator.OutputFile] };
    }

    private ReportErrors(ctx: GeneratorContext, errors: readonly string[]): void
    {
        const messages = errors.length > 0 ? errors : [DtoGenerator.NoModelMessage];
        for (const message of messages)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message, source: DtoGenerator.GeneratorId });
        }
    }
}
