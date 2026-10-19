import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { HtmlArtifacts } from "./html-artifacts.js";
import { AppNaming } from "../../project-services/generators/app-naming.js";

// Remote-flavor counterpart of EmitEntryAction: same import order (load-bearing, see
// EmitEntryAction), but the app is mounted through the async TodlAppBootstrap.PrepareAndMount,
// which awaits the model's first live fetch. The view-model is constructed in the
// beforeMount callback so it never reads the model before its data has arrived.
export class EmitRemoteEntryAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "emit-remote-entry";
    private static readonly OutputFile = "entry.ts";
    private static readonly AppClassToken = "{App}";

    private static readonly EntryTemplate =
        `import { app } from "./src/app.mu.js";\n` +
        `import { {App} } from "./src/main.js";\n` +
        `import { model } from "./generated/data.js";\n` +
        `import { TodlAppBootstrap } from "@pragmatic-tech-ai/todl";\n` +
        `void TodlAppBootstrap.PrepareAndMount(app, model, () => { new {App}(); });\n`;

    public readonly Name = EmitRemoteEntryAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [HtmlArtifacts.AppEntry];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const appClass = AppNaming.AppClass(ctx.Manifest.id ?? ctx.Manifest.name);
        const source = EmitRemoteEntryAction.EntryTemplate.split(EmitRemoteEntryAction.AppClassToken).join(appClass);
        await ctx.Sandbox.WriteText(EmitRemoteEntryAction.OutputFile, source);
        ctx.Artifacts.Set(HtmlArtifacts.AppEntry, EmitRemoteEntryAction.OutputFile);
    }
}
