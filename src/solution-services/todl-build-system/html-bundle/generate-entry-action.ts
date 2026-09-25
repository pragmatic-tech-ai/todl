import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { pascalCase } from "../../../codegen/naming.js";
import { NpmArtifacts } from "../npm/npm-artifacts.js";
import { HtmlArtifacts } from "./html-artifacts.js";

// The generated-entry producer of the per-project html-bundle app pipeline (spec
// §per-project-app-build, task 3): emits the per-project wiring that mounts the
// compiled UI with the model DTO as its DataContext — a project content generator
// (persistent, not sandbox), so generated/entry.ts stays under source control
// alongside the .todl.
export class GenerateEntryAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "generate-entry";
    private static readonly OutputFile = "generated/entry.ts";
    private static readonly BootstrapImportSpecifier = "@pragmatic-tech-ai/todl";
    private static readonly NoCompiledModelMessage = "no compiled model to generate an entry point from";

    private static readonly EntryTemplate =
        `import { app } from "../compiled/app.mu.js";\n` +
        `import { {{PkgClass}} } from "./model.js";\n` +
        `import { TodlAppBootstrap } from "{{BootstrapImportSpecifier}}";\n` +
        `const dto = {{PkgClass}}.fromJSON((window as any).__TODL_APP__);\n` +
        `TodlAppBootstrap.Mount(app, dto);\n`;

    public readonly Name = GenerateEntryAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [HtmlArtifacts.AppEntry];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const pkg = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (pkg === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: GenerateEntryAction.NoCompiledModelMessage, source: GenerateEntryAction.ActionName });
            return;
        }

        const name = ctx.Manifest.id ?? ctx.Manifest.name;
        const pkgClass = pascalCase(name);
        const src = GenerateEntryAction.EntryTemplate
            .replaceAll("{{PkgClass}}", pkgClass)
            .replaceAll("{{BootstrapImportSpecifier}}", GenerateEntryAction.BootstrapImportSpecifier);
        await ctx.Project.WriteText(GenerateEntryAction.OutputFile, src);
        ctx.Artifacts.Set(HtmlArtifacts.AppEntry, GenerateEntryAction.OutputFile);
    }
}
