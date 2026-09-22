import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { NpmArtifacts } from "../npm/npm-artifacts.js";
import { GraphAppBundle } from "../../../graph-api/generated/graph-app-bundle.js";
import { HtmlShell } from "./html-shell.js";

// Stages a single self-contained index.html: the inlined package set (packages + entry)
// on a window global plus the bundled-host app. The page composes a BundledDomainHost
// over the packages and mounts the explorer over host.Query().
export class EmitBundledHostAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "emit-bundled-host";
    private static readonly OutputFile = "index.html";
    private static readonly NoPackagesMessage = "no bundle packages to emit";

    public readonly Name = EmitBundledHostAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel, NpmArtifacts.BundlePackages];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const compiled = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        const packages = ctx.Artifacts.Get(NpmArtifacts.BundlePackages);
        if (compiled === undefined || packages === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: EmitBundledHostAction.NoPackagesMessage, source: EmitBundledHostAction.ActionName });
            return;
        }
        const entry = [{ model: compiled.id, version: compiled.version }];
        const html = HtmlShell.Render(JSON.stringify({ packages, entry }), GraphAppBundle);
        await ctx.Sandbox.WriteText(EmitBundledHostAction.OutputFile, html);
    }
}
