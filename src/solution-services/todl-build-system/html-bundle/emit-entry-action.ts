import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { pascalCase } from "../../../codegen/naming.js";
import { HtmlArtifacts } from "./html-artifacts.js";

// The entry-emitting action of the per-project html-bundle app pipeline (spec
// §per-project-app-build, task 10): emits the fixed build glue that mounts the
// compiled UI with the model DTO as its DataContext. Unlike the DtoGenerator and
// UiPlaceholderGenerator project content generators (project-services/generators/,
// which own generated/model.ts and generated/app.mu), this template is static — it
// does not depend on the compiled model's shape, only on the manifest's id/name —
// and it is never hand-edited, so it belongs in ctx.Sandbox (build glue), not
// ctx.Project (project content the generators own).
export class EmitEntryAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "emit-entry";
    private static readonly OutputFile = "generated/entry.ts";
    private static readonly BootstrapImportSpecifier = "@pragmatic-tech-ai/todl";

    private static readonly EntryTemplate =
        `import { app } from "../compiled/app.mu.js";\n` +
        `import { {{PkgClass}} } from "./model.js";\n` +
        `import { TodlAppBootstrap } from "{{BootstrapImportSpecifier}}";\n` +
        `const dto = {{PkgClass}}.fromJSON((window as any).__TODL_APP__);\n` +
        `TodlAppBootstrap.Mount(app, dto);\n`;

    public readonly Name = EmitEntryAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [HtmlArtifacts.AppEntry];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const name = ctx.Manifest.id ?? ctx.Manifest.name;
        const pkgClass = pascalCase(name);
        const src = EmitEntryAction.EntryTemplate
            .replaceAll("{{PkgClass}}", pkgClass)
            .replaceAll("{{BootstrapImportSpecifier}}", EmitEntryAction.BootstrapImportSpecifier);
        await ctx.Sandbox.WriteText(EmitEntryAction.OutputFile, src);
        ctx.Artifacts.Set(HtmlArtifacts.AppEntry, EmitEntryAction.OutputFile);
    }
}
