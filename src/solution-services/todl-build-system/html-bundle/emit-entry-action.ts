import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { HtmlArtifacts } from "./html-artifacts.js";
import { AppNaming } from "../../project-services/generators/app-naming.js";

// The entry-emitting action of the per-project html-bundle app pipeline: emits
// the fixed, static build glue (sandbox-root entry.ts) that imports the compiled
// app (src/app.mu.js), the app view-model class (src/main.js) and the initialized
// generated/data.js model, constructs the view-model once the Application exists,
// then calls TodlAppBootstrap.Mount(app, model). It is never hand-edited, so it
// belongs in ctx.Sandbox (build glue), not ctx.Project.
export class EmitEntryAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "emit-entry";
    private static readonly OutputFile = "entry.ts";

    private static readonly AppClassToken = "{App}";

    // Import order is load-bearing: app.mu.js constructs the Application (sets
    // Application.current) when it evaluates; the entry body then instantiates the
    // view-model, whose constructor self-registers via
    // Application.current.Services.addInstance(this). main.js only defines the class
    // (app.mu.js imports it transitively, so it evaluates before the Application exists).
    private static readonly EntryTemplate =
        `import { app } from "./src/app.mu.js";\n` +
        `import { {App} } from "./src/main.js";\n` +
        `import { model } from "./generated/data.js";\n` +
        `import { TodlAppBootstrap } from "@pragmatic-tech-ai/todl";\n` +
        `new {App}();\n` +
        `TodlAppBootstrap.Mount(app, model);\n`;

    public readonly Name = EmitEntryAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [HtmlArtifacts.AppEntry];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const appClass = AppNaming.AppClass(ctx.Manifest.id ?? ctx.Manifest.name);
        const source = EmitEntryAction.EntryTemplate.split(EmitEntryAction.AppClassToken).join(appClass);
        await ctx.Sandbox.WriteText(EmitEntryAction.OutputFile, source);
        ctx.Artifacts.Set(HtmlArtifacts.AppEntry, EmitEntryAction.OutputFile);
    }
}
