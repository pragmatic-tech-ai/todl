/**
 * Produces `src/app.mu`, the user-owned Application scaffold that pairs with the
 * generated app view-model class in `src/main.ts`. Written once at project creation
 * via WritePolicy.WriteOnce; afterwards the user owns the file, and WriteOnce never
 * touches an existing one. The scaffold needs no compiled model, only the identity.
 */

import { AppUiTemplate } from "../../todl-build-system/html-bundle/app-ui-template.js";
import { WritePolicy } from "./project-content-generator.js";
import { WritePolicyWriter } from "./write-policy-writer.js";
import { GeneratorTrigger, type IProjectContentGenerator, type GeneratorContext, type GeneratorResult } from "./project-content-generator.js";

export class AppGenerator implements IProjectContentGenerator
{
    private static readonly GeneratorId = "app-ui";
    private static readonly Display = "App UI";
    private static readonly OutputFile = "src/app.mu";

    public readonly Id = AppGenerator.GeneratorId;
    public readonly DisplayName = AppGenerator.Display;
    public readonly Produces: readonly string[] = [AppGenerator.OutputFile];
    public readonly Triggers: readonly GeneratorTrigger[] = [GeneratorTrigger.ProjectCreated];
    public readonly WritePolicy = WritePolicy.WriteOnce;

    public async Generate(ctx: GeneratorContext): Promise<GeneratorResult>
    {
        const identity = ctx.Manifest.id ?? ctx.Manifest.name;
        const markup = AppUiTemplate.Render(identity);
        const wrote = await WritePolicyWriter.Write(ctx.Project, AppGenerator.OutputFile, markup, this.WritePolicy);
        return wrote ? { Written: [AppGenerator.OutputFile], Skipped: [] } : { Written: [], Skipped: [AppGenerator.OutputFile] };
    }
}
