import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import { NpmArtifacts } from "../npm/npm-artifacts.js";
import { HtmlArtifacts } from "./html-artifacts.js";
import { HtmlShell } from "./html-shell.js";
import type { ResolvedClosureMember } from "../../project-services/core/base-resolver.js";
import type { CompiledPackage } from "../../../publish/publish.js";
import { ServableManifest, type ServablePackageRef } from "./servable-manifest.js";
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
    private static readonly ModelFile = "model.json";
    private static readonly PackagesDir = "packages";
    private static readonly PathSeparator = "/";
    private static readonly Newline = "\n";
    private static readonly KeySeparator = "@";
    private static readonly NoClosureMessage = "no resolved package closure to emit a deployable remote app from";
    private static readonly NoCompiledModelMessage = "no compiled model to emit a remote host from";
    private static readonly NoAppBundleMessage = "no app bundle to emit a remote host from";

    public readonly Name = EmitRemoteHostAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel, HtmlArtifacts.AppBundle, NpmArtifacts.ResolvedClosure, HtmlArtifacts.FontAssets];
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
        const closure = ctx.Artifacts.Get(NpmArtifacts.ResolvedClosure);
        if (closure === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: EmitRemoteHostAction.NoClosureMessage, source: EmitRemoteHostAction.ActionName });
            return;
        }
        await ctx.Sandbox.WriteText(EmitRemoteHostAction.HostFile, HtmlShell.RenderRemote(appBundle));
        const packages = await EmitRemoteHostAction.EmitClosure(ctx, compiled, closure);
        // The theme fonts EmitFontsAction wrote (if any) must be served alongside the page, or
        // mural's glyph-geometry text measurement NaNs and the whole layout collapses.
        const fonts = ctx.Artifacts.Get(HtmlArtifacts.FontAssets) ?? [];
        const manifest = ServableManifest.For(
            remote.AppName,
            compiled.version,
            packages,
            EmitRemoteHostAction.HostFile,
            [EmitRemoteHostAction.HostFile, ...fonts],
        );
        await ctx.Sandbox.WriteText(EmitRemoteHostAction.ManifestFile, JSON.stringify(manifest, null, EmitRemoteHostAction.JsonIndent));
    }

    // Writes <PackagesDir>/<id>/<version>/model.json for the app package and for every
    // member of the already-resolved dependency closure (ResolveBasesAction ResolvedClosure),
    // returning the {id, version} pairs emitted (app first, then deps, de-duplicated). A deploy
    // payload is assembled from these; the server rejects anything short of the full closure.
    // Scoped package ids (@scope/x) nest an extra directory level; untested in SP0.
    private static async EmitClosure(ctx: TodlBuildContext, compiled: CompiledPackage, closure: readonly ResolvedClosureMember[]): Promise<ServablePackageRef[]>
    {
        const emitted: ServablePackageRef[] = [];
        const seen = new Set<string>();
        await EmitRemoteHostAction.WriteMember(ctx, emitted, seen, compiled.id, compiled.version, compiled.document);
        for (const member of closure)
        {
            const dependencies = member.Package.Dependencies;
            const document = dependencies.length > 0
                ? { ...member.Package.Document, dependencies: [...dependencies] }
                : member.Package.Document;
            await EmitRemoteHostAction.WriteMember(ctx, emitted, seen, member.Ref.id, member.Ref.version, document);
        }
        return emitted;
    }

    // Writes one package model.json (newline-terminated, like the npm flavor) unless that
    // id@version was already emitted; records it in `emitted` and `seen`.
    private static async WriteMember(
        ctx: TodlBuildContext,
        emitted: ServablePackageRef[],
        seen: Set<string>,
        id: string,
        version: string,
        document: unknown,
    ): Promise<void>
    {
        const key = id + EmitRemoteHostAction.KeySeparator + version;
        if (seen.has(key)) return;
        seen.add(key);
        emitted.push({ id, version });
        const path = [EmitRemoteHostAction.PackagesDir, id, version, EmitRemoteHostAction.ModelFile].join(EmitRemoteHostAction.PathSeparator);
        await ctx.Sandbox.WriteText(path, JSON.stringify(document, null, EmitRemoteHostAction.JsonIndent) + EmitRemoteHostAction.Newline);
    }
}
