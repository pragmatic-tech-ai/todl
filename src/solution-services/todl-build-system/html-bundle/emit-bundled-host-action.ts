import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { NpmArtifacts } from "../npm/npm-artifacts.js";
import { TodlProjectSourceFiles } from "../../project-services/core/todl-sources.js";
import { checkAgainst } from "../../../compiler-services/api.js";
import { ApplicationModelData } from "../../../codegen/application-model-data.js";
import { MuralAppBundle } from "../../../graph-api/generated/graph-app-bundle.js";
import { Base64 } from "../../../graph-api/browser/base64.js";
import { HtmlShell } from "./html-shell.js";

// Stages a single self-contained index.html: the inlined { shards, root, resources } app
// payload on a window global plus the pre-bundled mural host. The page builds a
// ModelRegistry from the shards and runs it through MuralHost -> HtmlTarget. The
// Repository is re-derived (checkAgainst) because CompiledModel carries only a document.
export class EmitBundledHostAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "emit-bundled-host";
    private static readonly OutputFile = "index.html";
    private static readonly NoCompiledModelMessage = "no compiled model to emit a bundled host from";

    public readonly Name = EmitBundledHostAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel, NpmArtifacts.ResolvedBases, NpmArtifacts.BundleResources];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const compiled = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (compiled === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: EmitBundledHostAction.NoCompiledModelMessage, source: EmitBundledHostAction.ActionName });
            return;
        }

        const bases = ctx.Artifacts.Get(NpmArtifacts.ResolvedBases) ?? [];
        const sources = await TodlProjectSourceFiles.Collect(ctx.Project);
        const { model } = checkAgainst([...bases], [...sources]);

        let data;
        try
        {
            data = ApplicationModelData.WithSoleModelFallback(model);
        }
        catch (error)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: (error as Error).message, source: EmitBundledHostAction.ActionName });
            return;
        }

        const resources = (ctx.Artifacts.Get(NpmArtifacts.BundleResources) ?? []).map((r) => ({ uri: r.uri, base64: Base64.Encode(r.bytes) }));
        const payload = { shards: Object.fromEntries(data.shards), root: data.root, resources };
        const html = HtmlShell.Render(JSON.stringify(payload), MuralAppBundle);
        await ctx.Sandbox.WriteText(EmitBundledHostAction.OutputFile, html);
    }
}
