/**
 * Scaffolds `src/main.ts`: the user-owned application view-model class. Written
 * ONCE at project creation (WriteOnce) and never touched again. Needs no model
 * compile: the class name derives from the manifest identity (`id ?? name`) via
 * `AppNaming`, while the greeting uses the raw project name.
 */

import { WritePolicy, GeneratorTrigger, type IProjectContentGenerator, type GeneratorContext, type GeneratorResult } from "./project-content-generator.js";
import { WritePolicyWriter } from "./write-policy-writer.js";
import { AppNaming } from "./app-naming.js";

export class AppViewModelGenerator implements IProjectContentGenerator
{
    private static readonly GeneratorId = "app-view-model";
    private static readonly Display = "Application view-model";
    private static readonly OutputFile = "src/main.ts";
    private static readonly Eol = "\n";
    private static readonly Template = [
        "import { Application } from \"@pragmatic-tech-ai/mural\";",
        "import { Observable } from \"@pragmatic-tech-ai/mural/runtime\";",
        "import { model } from \"../generated/data.js\";",
        "",
        "export class {App} extends Observable",
        "{",
        "    constructor()",
        "    {",
        "        super();",
        "        Application.current?.Services.addInstance(this);",
        "    }",
        "",
        "    public get HelloText(): string",
        "    {",
        "        return \"Hello from {Project}\";",
        "    }",
        "",
        "    public get ConceptSummary(): string",
        "    {",
        "        return `The application has access to ${model.ConceptNames().length} concepts`;",
        "    }",
        "}",
        "",
        "new {App}();",
        "",
    ].join(AppViewModelGenerator.Eol);
    private static readonly AppToken = "{App}";
    private static readonly ProjectToken = "{Project}";

    public readonly Id = AppViewModelGenerator.GeneratorId;
    public readonly DisplayName = AppViewModelGenerator.Display;
    public readonly Produces: readonly string[] = [AppViewModelGenerator.OutputFile];
    public readonly Triggers: readonly GeneratorTrigger[] = [GeneratorTrigger.ProjectCreated];
    public readonly WritePolicy = WritePolicy.WriteOnce;

    public async Generate(ctx: GeneratorContext): Promise<GeneratorResult>
    {
        const appClass = AppNaming.AppClass(ctx.Manifest.id ?? ctx.Manifest.name);
        const body = AppViewModelGenerator.Template
            .split(AppViewModelGenerator.AppToken).join(appClass)
            .split(AppViewModelGenerator.ProjectToken).join(ctx.Manifest.name);
        const wrote = await WritePolicyWriter.Write(ctx.Project, AppViewModelGenerator.OutputFile, body, this.WritePolicy);
        return wrote ? { Written: [AppViewModelGenerator.OutputFile], Skipped: [] } : { Written: [], Skipped: [AppViewModelGenerator.OutputFile] };
    }
}
