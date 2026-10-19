import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { HtmlArtifacts } from "./html-artifacts.js";
import { AppNaming } from "../../project-services/generators/app-naming.js";

// Remote-flavor counterpart of EmitEntryAction: same import order (load-bearing, see
// EmitEntryAction), and — like the bundled entry — the view-model is constructed
// SYNCHRONOUSLY at entry load, before mounting. This registers it in
// Application.current.Services within the same tick the app module loaded, so the
// app.mu ContentPresenter's `$service(App)` binding resolves it on its first
// (next-microtask) retry. Constructing it later (e.g. in a beforeMount that runs
// after an awaited live fetch) misses that retry window — the service stays
// unresolved and the view renders empty. The view-model reads its model data only
// through bindings/getters, which evaluate at render time; PrepareAndMount still
// awaits the first live fetch before mounting, so the data is present by then.
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
        `new {App}();\n` +
        `void TodlAppBootstrap.PrepareAndMount(app, model);\n`;

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
