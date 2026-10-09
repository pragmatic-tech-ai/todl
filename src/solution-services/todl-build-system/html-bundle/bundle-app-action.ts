import type { IStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import type { IBundler, StagedFile } from "../../build-system-core/bundler.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import { HtmlArtifacts } from "./html-artifacts.js";

// The bundler action of the per-project html-bundle app pipeline: gathers the staged
// app (the src/ and generated/ trees from ctx.Project, the compiled UI modules and the
// entry glue from ctx.Sandbox) into plain StagedFile[] and delegates the actual bundling to an
// injected IBundler, recording its output under HtmlArtifacts.AppBundle. This action is
// browser-safe: all node-only work (esbuild, filesystem staging, module resolution)
// lives behind the IBundler seam.
export class BundleAppAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "bundle-app";
    // The hidden entry imports the app root by this fixed path, so no discovery is needed;
    // it is only checked (softly) so a missing root is a clear diagnostic, not an esbuild one.
    private static readonly AppRootModule = "src/app.mu.js";
    private static readonly SourceDirectory = "src";
    private static readonly GeneratedDirectory = "generated";
    private static readonly PathSeparator = "/";

    private static readonly MissingEntryMessage = "no app entry to bundle";
    private static readonly MissingAppRootMessage =
        `no ${BundleAppAction.AppRootModule} among the compiled UI modules to bundle as the app root`;
    private static readonly BundleFailedMessagePrefix = "failed to bundle the app: ";

    public readonly Name = BundleAppAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [
        HtmlArtifacts.AppEntry,
        HtmlArtifacts.CompiledUi,
    ];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [HtmlArtifacts.AppBundle];

    constructor(private readonly bundler: IBundler)
    {
    }

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const entry = ctx.Artifacts.Get(HtmlArtifacts.AppEntry);
        if (entry === undefined)
        {
            this.ReportError(ctx, BundleAppAction.MissingEntryMessage);
            return;
        }

        const compiled = ctx.Artifacts.Get(HtmlArtifacts.CompiledUi) ?? [];
        if (!compiled.includes(BundleAppAction.AppRootModule))
        {
            this.ReportError(ctx, BundleAppAction.MissingAppRootMessage);
            return;
        }

        // Gathering and bundling are inside the try so ANY failure (storage read, the
        // bundler itself) is reported as a Severity.Error and Execute returns normally,
        // honoring the no-throw contract.
        try
        {
            const files = await this.Collect(ctx, entry, compiled);
            const result = await this.bundler.BundleApp({ Entry: entry, Files: files });
            for (const diagnostic of result.Diagnostics) ctx.Diagnostics.Report(diagnostic);
            if (result.Text !== undefined) ctx.Artifacts.Set(HtmlArtifacts.AppBundle, result.Text);
        }
        catch (err)
        {
            const detail = err instanceof Error ? err.message : String(err);
            this.ReportError(ctx, `${BundleAppAction.BundleFailedMessagePrefix}${detail}`);
        }
    }

    // The project src/ and generated/ trees (Project) at their own relative paths, then the
    // compiled modules and the entry (Sandbox — build output/glue). Sandbox files are added
    // last and win on a path collision, so a project file can never clobber a compiled
    // sibling *.mu.js.
    private async Collect(ctx: TodlBuildContext, entry: string, compiled: readonly string[]): Promise<StagedFile[]>
    {
        const projectFiles: StagedFile[] = [];
        await this.GatherTree(ctx.Project, BundleAppAction.SourceDirectory, projectFiles);
        await this.GatherTree(ctx.Project, BundleAppAction.GeneratedDirectory, projectFiles);

        const sandboxFiles: StagedFile[] = [];
        for (const path of compiled) sandboxFiles.push({ Path: path, Text: await ctx.Sandbox.ReadText(path) });
        sandboxFiles.push({ Path: entry, Text: await ctx.Sandbox.ReadText(entry) });

        const sandboxPaths = new Set(sandboxFiles.map((f) => f.Path));
        return [...projectFiles.filter((f) => !sandboxPaths.has(f.Path)), ...sandboxFiles];
    }

    private async GatherTree(storage: IStorage, dir: string, out: StagedFile[]): Promise<void>
    {
        for (const entry of await storage.List(dir))
        {
            const path = `${dir}${BundleAppAction.PathSeparator}${entry.Name}`;
            if (entry.IsDirectory) await this.GatherTree(storage, path, out);
            else out.push({ Path: path, Text: await storage.ReadText(path) });
        }
    }

    private ReportError(ctx: TodlBuildContext, message: string): void
    {
        ctx.Diagnostics.Report({ severity: Severity.Error, message, source: BundleAppAction.ActionName });
    }
}
