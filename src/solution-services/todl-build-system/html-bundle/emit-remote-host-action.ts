import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { NpmArtifacts } from "../npm/npm-artifacts.js";
import { HtmlArtifacts } from "./html-artifacts.js";
import { HtmlShell } from "./html-shell.js";
import { ServableManifest } from "./servable-manifest.js";
import { RemoteTargetReader } from "./remote-target-reader.js";

// Remote-flavor host emit: a payload-FREE index.html (the app fetches its data live) plus
// the servable-app manifest a tenant serves it by. The UI bundle is inlined in index.html,
// so the manifest's single asset is that page.
export class EmitRemoteHostAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "emit-remote-host";
    private static readonly HostFile = "index.html";
    private static readonly ManifestFile = "servable-manifest.json";
    private static readonly JsonIndent = 2;
    private static readonly NoCompiledModelMessage = "no compiled model to emit a remote host from";
    private static readonly NoAppBundleMessage = "no app bundle to emit a remote host from";

    public readonly Name = EmitRemoteHostAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel, HtmlArtifacts.AppBundle];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const remote = RemoteTargetReader.Read(ctx, EmitRemoteHostAction.ActionName);
        if (remote === undefined) return;
        const compiled = ctx.Artifacts.Get(NpmArtifacts.CompiledModel);
        if (compiled === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: EmitRemoteHostAction.NoCompiledModelMessage, source: EmitRemoteHostAction.ActionName });
            return;
        }
        const appBundle = ctx.Artifacts.Get(HtmlArtifacts.AppBundle);
        if (appBundle === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: EmitRemoteHostAction.NoAppBundleMessage, source: EmitRemoteHostAction.ActionName });
            return;
        }
        await ctx.Sandbox.WriteText(EmitRemoteHostAction.HostFile, HtmlShell.RenderRemote(appBundle));
        const manifest = ServableManifest.For(
            remote.AppName,
            compiled.version,
            [{ id: compiled.id, version: compiled.version }],
            EmitRemoteHostAction.HostFile,
            [EmitRemoteHostAction.HostFile],
        );
        await ctx.Sandbox.WriteText(EmitRemoteHostAction.ManifestFile, JSON.stringify(manifest, null, EmitRemoteHostAction.JsonIndent));
    }
}
