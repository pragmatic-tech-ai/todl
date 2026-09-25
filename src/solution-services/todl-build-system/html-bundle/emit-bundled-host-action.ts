import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { NpmArtifacts } from "../npm/npm-artifacts.js";
import { HtmlArtifacts } from "./html-artifacts.js";
import { HtmlShell } from "./html-shell.js";

// Stages a single self-contained index.html: the compiled model's full document, inlined
// on a window global, plus the per-build compiled app bundle (produced by BundleAppAction).
// The page's generated entry builds the DTO via `<Pkg>.fromJSON(window.__TODL_APP__)`, and
// ModelDataSource.fromJSON(doc: TodlDocument) takes exactly that shape — no shard/root
// payload assembly here, and no resource inlining (deferred follow-up).
export class EmitBundledHostAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "emit-bundled-host";
    private static readonly OutputFile = "index.html";
    private static readonly NoCompiledModelMessage = "no compiled model to emit a bundled host from";
    private static readonly NoAppBundleMessage = "no app bundle to emit a bundled host from";

    public readonly Name = EmitBundledHostAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel, HtmlArtifacts.AppBundle];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const compiled = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (compiled === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: EmitBundledHostAction.NoCompiledModelMessage, source: EmitBundledHostAction.ActionName });
            return;
        }

        const appBundle = ctx.Artifacts.Get(HtmlArtifacts.AppBundle);
        if (appBundle === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: EmitBundledHostAction.NoAppBundleMessage, source: EmitBundledHostAction.ActionName });
            return;
        }

        const payload = compiled.fullDocument;
        const html = HtmlShell.Render(JSON.stringify(payload), appBundle);
        await ctx.Sandbox.WriteText(EmitBundledHostAction.OutputFile, html);
    }
}
