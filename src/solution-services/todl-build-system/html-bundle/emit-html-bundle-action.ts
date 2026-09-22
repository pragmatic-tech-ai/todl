import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { NpmArtifacts } from "../npm/npm-artifacts.js";
import { GraphAppBundle } from "../../../graph-api/generated/graph-app-bundle.js";
import { HtmlShell } from "./html-shell.js";

// Stages a single self-contained index.html into the sandbox: the full compiled document
// inlined on a window global + the graph-app bundle. Consumes the compiled model produced
// by CompileModelAction; uses fullDocument (the closure) so every ref resolves in-page.
export class EmitHtmlBundleAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "emit-html-bundle";
    private static readonly OutputFile = "index.html";
    private static readonly NoModelMessage = "no compiled model to bundle";

    public readonly Name = EmitHtmlBundleAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const pkg = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (pkg === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: EmitHtmlBundleAction.NoModelMessage, source: EmitHtmlBundleAction.ActionName });
            return;
        }
        const html = HtmlShell.Render(JSON.stringify(pkg.fullDocument), GraphAppBundle);
        await ctx.Sandbox.WriteText(EmitHtmlBundleAction.OutputFile, html);
    }
}
