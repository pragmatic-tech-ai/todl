import { build } from "esbuild";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyTree } from "@pragmatic-tech-ai/todl-runtime";
import { NodeFsStorage } from "@pragmatic-tech-ai/todl-runtime/node";
import type { IBuildAction } from "../../build-system-core/build-action.js";
import type { ArtifactKey } from "../../build-system-core/artifact-key.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
import type { TodlBuildContext } from "../todl-build-context.js";
import { HtmlArtifacts } from "./html-artifacts.js";

// The TS bundler action of the per-project html-bundle app pipeline (spec
// §per-project-app-build, task 6): bundles the generated entry — with the compiled
// model DTO, the compiled UI modules, and the mural/todl runtimes it imports — into a
// single browser IIFE string recorded under HtmlArtifacts.AppBundle, so the emit action
// can inline it with no bundler at emit time.
//
// The hard part is module resolution across storages. The generated entry lives in
// ctx.Project, the compiled UI in ctx.Sandbox, and both are IStorage abstractions that
// may not be a single on-disk root and never have node_modules adjacent — yet the entry
// imports the bare packages "@pragmatic-tech-ai/todl" (and, transitively, "@pragmatic-
// tech-ai/mural/runtime"), which esbuild resolves on the REAL filesystem by walking up
// to node_modules. So the action MATERIALIZES both stores into one on-disk staging dir
// created INSIDE the TODL repo/source-checkout root: from there esbuild reaches that
// root's node_modules by walking up, and "@pragmatic-tech-ai/todl" (the package the
// staged files sit inside) resolves by package self-reference against its exports map.
//
// SCOPE: this currently supports building TODL projects from an in-repo / source
// checkout, where "@pragmatic-tech-ai/*" resolve to their TypeScript `src` under the
// `development` export condition (see DevelopmentCondition below). A published/installed
// TODL (which ships only `dist`, per package.json `files`) is NOT yet supported — that
// dist-based resolution is a KNOWN FOLLOW-UP, deferred by ruling.
export class BundleAppAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = "bundle-app";
    private static readonly AppRootModule = "compiled/app.mu.js";
    private static readonly AppRootExportMarker = "export const app";
    private static readonly GeneratedDirectory = "generated";
    private static readonly NodeModulesDirectory = "node_modules";
    private static readonly StagePrefix = "todl-bundle-stage-";

    private static readonly EsbuildFormat = "iife";
    private static readonly EsbuildPlatform = "browser";
    private static readonly EsbuildTarget = "es2020";
    private static readonly EsbuildLogLevel = "silent";
    // The package.json `import` conditions map "@pragmatic-tech-ai/*" to their `src`
    // TypeScript entries, so this build resolves and bundles those packages FROM SOURCE,
    // mirroring the proven scripts/gen-graph-app.mjs path and matching the runner
    // (`--conditions=development`). This is why the action is scoped to in-repo / source
    // checkouts (see class doc): a published/installed TODL ships only `dist` (its `src`
    // is absent), so under this condition resolution would fail. Making a published build
    // work would mean resolving the `default` (built `dist`) exports instead — a known
    // follow-up, not currently supported.
    private static readonly DevelopmentCondition = "development";

    private static readonly MissingEntryMessage = "no app entry to bundle";
    private static readonly MissingAppRootMessage =
        `no ${BundleAppAction.AppRootModule} among the compiled UI modules to bundle as the app root`;
    private static readonly MultipleAppRootsMessagePrefix =
        "more than one compiled module is an application root; disambiguation is not supported: ";
    private static readonly NoResolutionRootMessage =
        "could not locate a node_modules root to resolve the app's package imports against";
    private static readonly BundleFailedMessagePrefix = "failed to bundle the app: ";

    public readonly Name = BundleAppAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [
        HtmlArtifacts.AppEntry,
        HtmlArtifacts.CompiledUi,
        HtmlArtifacts.GeneratedDto,
    ];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [HtmlArtifacts.AppBundle];

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const entry = ctx.Artifacts.Get(HtmlArtifacts.AppEntry);
        if (entry === undefined)
        {
            this.ReportError(ctx, BundleAppAction.MissingEntryMessage);
            return;
        }

        const compiled = ctx.Artifacts.Get(HtmlArtifacts.CompiledUi) ?? [];
        if (!(await this.GuardAppRoots(ctx, compiled))) return;

        const resolutionRoot = BundleAppAction.ResolutionRoot();
        if (resolutionRoot === undefined)
        {
            this.ReportError(ctx, BundleAppAction.NoResolutionRootMessage);
            return;
        }

        // The whole staging + bundle is inside the try so ANY failure — temp-dir
        // creation (read-only root, disk full, permissions), the cross-store copy, or
        // esbuild itself — is reported as a Severity.Error and Execute returns normally,
        // honoring the no-throw contract. stageDir may still be unset if mkdtempSync
        // itself threw, so the finally cleanup guards for that.
        let stageDir: string | undefined;
        try
        {
            stageDir = mkdtempSync(join(resolutionRoot, BundleAppAction.StagePrefix));
            const bundle = await this.BundleStaged(ctx, entry, compiled, resolutionRoot, stageDir);
            if (bundle !== undefined) ctx.Artifacts.Set(HtmlArtifacts.AppBundle, bundle);
        }
        catch (err)
        {
            const detail = err instanceof Error ? err.message : String(err);
            this.ReportError(ctx, `${BundleAppAction.BundleFailedMessagePrefix}${detail}`);
        }
        finally
        {
            if (stageDir !== undefined) rmSync(stageDir, { recursive: true, force: true });
        }
    }

    // Verifies exactly one application root is bundleable: the hardcoded compiled/app.mu.js
    // must be present, and (best-effort) no more than one compiled module may export `app`.
    private async GuardAppRoots(ctx: TodlBuildContext, compiled: readonly string[]): Promise<boolean>
    {
        if (!compiled.includes(BundleAppAction.AppRootModule))
        {
            this.ReportError(ctx, BundleAppAction.MissingAppRootMessage);
            return false;
        }

        const roots: string[] = [];
        for (const path of compiled)
        {
            const js = await ctx.Sandbox.ReadText(path);
            if (js.includes(BundleAppAction.AppRootExportMarker)) roots.push(path);
        }
        if (roots.length > 1)
        {
            this.ReportError(ctx, `${BundleAppAction.MultipleAppRootsMessagePrefix}${roots.join(", ")}`);
            return false;
        }
        return true;
    }

    // Materializes the generated tree (from Project) and the compiled modules (from
    // Sandbox) into stageDir, then runs esbuild over the staged entry. esbuild resolves
    // bare package imports against resolutionRoot's node_modules (nodePaths) and, for the
    // enclosing "@pragmatic-tech-ai/todl" package, by self-reference from inside the root.
    private async BundleStaged(
        ctx: TodlBuildContext,
        entry: string,
        compiled: readonly string[],
        resolutionRoot: string,
        stageDir: string): Promise<string | undefined>
    {
        const stage = new NodeFsStorage(stageDir);
        await copyTree(ctx.Project, BundleAppAction.GeneratedDirectory, stage, BundleAppAction.GeneratedDirectory, true);
        for (const path of compiled)
        {
            await copyTree(ctx.Sandbox, path, stage, path, false);
        }

        try
        {
            const result = await build({
                entryPoints: [join(stageDir, entry)],
                bundle: true,
                format: BundleAppAction.EsbuildFormat,
                platform: BundleAppAction.EsbuildPlatform,
                target: BundleAppAction.EsbuildTarget,
                keepNames: true,
                write: false,
                logLevel: BundleAppAction.EsbuildLogLevel,
                absWorkingDir: stageDir,
                nodePaths: [join(resolutionRoot, BundleAppAction.NodeModulesDirectory)],
                conditions: [BundleAppAction.DevelopmentCondition],
            });
            return result.outputFiles[0]!.text;
        }
        catch (err)
        {
            const detail = err instanceof Error ? err.message : String(err);
            this.ReportError(ctx, `${BundleAppAction.BundleFailedMessagePrefix}${detail}`);
            return undefined;
        }
    }

    private ReportError(ctx: TodlBuildContext, message: string): void
    {
        ctx.Diagnostics.Report({ severity: Severity.Error, message, source: BundleAppAction.ActionName });
    }

    // Walks up from this module to the nearest ancestor directory that contains a
    // node_modules folder — the TODL repo/source-checkout root when running in-repo (the
    // supported scope; see class doc). The staging dir is created inside it so esbuild's
    // upward node_modules walk (and the "@pragmatic-tech-ai/todl" package self-reference)
    // resolve there.
    private static ResolutionRoot(): string | undefined
    {
        let dir = dirname(fileURLToPath(import.meta.url));
        while (true)
        {
            if (existsSync(join(dir, BundleAppAction.NodeModulesDirectory))) return dir;
            const parent = dirname(dir);
            if (parent === dir) return undefined;
            dir = parent;
        }
    }
}
