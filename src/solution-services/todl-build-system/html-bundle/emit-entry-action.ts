import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { HtmlArtifacts } from "./html-artifacts.js";

// The entry-emitting action of the per-project html-bundle app pipeline: emits
// the fixed, static build glue (sandbox-root entry.ts) that evaluates the
// compiled src/app.mu.js, then src/main.js, and mounts the UI with the
// initialized generated/data.js model as its DataContext. It is never
// hand-edited, so it belongs in ctx.Sandbox (build glue), not ctx.Project.
export class EmitEntryAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "emit-entry";
    private static readonly OutputFile = "entry.ts";

    // Import order is load-bearing: app.mu.js constructs the Application (sets
    // Application.current) before main.js's top-level `new <Vm>()` registers itself
    // via Application.current.Services.addInstance(this).
    private static readonly EntrySource =
        `import { app } from "./src/app.mu.js";
` +
        `import "./src/main.js";
` +
        `import { model } from "./generated/data.js";
` +
        `import { TodlAppBootstrap } from "@pragmatic-tech-ai/todl";
` +
        `TodlAppBootstrap.Mount(app, model);
`;

    public readonly Name = EmitEntryAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [HtmlArtifacts.AppEntry];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        await ctx.Sandbox.WriteText(EmitEntryAction.OutputFile, EmitEntryAction.EntrySource);
        ctx.Artifacts.Set(HtmlArtifacts.AppEntry, EmitEntryAction.OutputFile);
    }
}
