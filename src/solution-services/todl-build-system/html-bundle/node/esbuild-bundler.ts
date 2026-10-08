import { build } from "esbuild";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Severity, type BuildDiagnostic } from "../../../build-system-core/diagnostic-sink.js";
import type { IBundler, BundleAppRequest, BundleAppResult } from "../../../build-system-core/bundler.js";

// Node-only IBundler: stages the request's files into an on-disk dir created INSIDE the
// nearest node_modules-bearing root (so esbuild's upward node_modules walk resolves bare
// package imports there, and "@pragmatic-tech-ai/todl" self-references), then bundles the
// entry to a browser IIFE. Failures are reported as Severity.Error diagnostics, never thrown.
//
// RESOLUTION: "@pragmatic-tech-ai/*" are bundled from their TypeScript `src` under the
// `development` export condition when a source checkout is resolvable (in-repo). When
// todl is consumed installed/dist-only (ships only `dist`), the `development` condition is
// omitted so esbuild resolves the `default` (built `dist`) exports instead.
export class EsbuildBundler implements IBundler
{
    private static readonly ActionName = "bundle-app";
    private static readonly StagePrefix = "todl-bundle-stage-";
    private static readonly NodeModulesDirectory = "node_modules";
    private static readonly TodlPackageName = "@pragmatic-tech-ai/todl";
    private static readonly PackageJsonFile = "package.json";
    private static readonly ScopedTodlDir = EsbuildBundler.TodlPackageName;
    private static readonly ManifestEncoding = "utf8";

    private static readonly EsbuildFormat = "iife";
    private static readonly EsbuildPlatform = "browser";
    private static readonly EsbuildTarget = "es2020";
    private static readonly EsbuildLogLevel = "silent";
    // The `development` export condition maps "@pragmatic-tech-ai/*" to their `src`
    // TypeScript entries, bundling those packages FROM SOURCE. Applied only when a source
    // checkout is resolvable; ResolveConditions omits it for an installed/dist-only todl.
    private static readonly DevelopmentCondition = "development";

    private static readonly NoResolutionRootMessage =
        "could not locate a node_modules root to resolve the app's package imports against";
    private static readonly BundleFailedMessagePrefix = "failed to bundle the app: ";

    public async BundleApp(request: BundleAppRequest): Promise<BundleAppResult>
    {
        const resolutionRoot = this.ResolutionRoot();
        if (resolutionRoot === undefined)
        {
            return EsbuildBundler.Failure(EsbuildBundler.NoResolutionRootMessage);
        }

        // The whole staging + bundle is inside the try so ANY failure (temp-dir creation,
        // file writes, esbuild) is a Severity.Error diagnostic. stageDir may still be unset
        // if mkdtempSync itself threw, so the finally cleanup guards for that.
        let stageDir: string | undefined;
        try
        {
            stageDir = mkdtempSync(join(resolutionRoot, EsbuildBundler.StagePrefix));
            for (const file of request.Files)
            {
                const abs = join(stageDir, file.Path);
                mkdirSync(dirname(abs), { recursive: true });
                writeFileSync(abs, file.Text);
            }
            const result = await build({
                entryPoints: [join(stageDir, request.Entry)],
                bundle: true,
                format: EsbuildBundler.EsbuildFormat,
                platform: EsbuildBundler.EsbuildPlatform,
                target: EsbuildBundler.EsbuildTarget,
                keepNames: true,
                write: false,
                logLevel: EsbuildBundler.EsbuildLogLevel,
                absWorkingDir: stageDir,
                nodePaths: [join(resolutionRoot, EsbuildBundler.NodeModulesDirectory)],
                conditions: EsbuildBundler.ResolveConditions(resolutionRoot),
            });
            return { Text: result.outputFiles[0]!.text, Diagnostics: [] };
        }
        catch (err)
        {
            const detail = err instanceof Error ? err.message : String(err);
            return EsbuildBundler.Failure(`${EsbuildBundler.BundleFailedMessagePrefix}${detail}`);
        }
        finally
        {
            if (stageDir !== undefined) rmSync(stageDir, { recursive: true, force: true });
        }
    }

    private static Failure(message: string): BundleAppResult
    {
        const diagnostic: BuildDiagnostic = { severity: Severity.Error, message, source: EsbuildBundler.ActionName };
        return { Diagnostics: [diagnostic] };
    }

    // Walks up from this module to the nearest ancestor directory that contains a
    // node_modules folder: the todl source-checkout root when running in-repo, or the
    // consumer's package root when todl is installed. The staging dir is created inside
    // it so esbuild's upward node_modules walk resolves bare package imports there.
    // `protected` (not static) so a test can override it to point at a fixture root.
    protected ResolutionRoot(): string | undefined
    {
        let dir = dirname(fileURLToPath(import.meta.url));
        while (true)
        {
            if (existsSync(join(dir, EsbuildBundler.NodeModulesDirectory))) return dir;
            const parent = dirname(dir);
            if (parent === dir) return undefined;
            dir = parent;
        }
    }

    // Selects esbuild resolution conditions by what the resolvable todl package provides
    // on disk. The `development` export maps "@pragmatic-tech-ai/*" to their TypeScript
    // `src`; a published/installed todl ships only `dist` (its `development` target is
    // absent). So: return ['development'] ONLY when todl's development entry file exists
    // (a source checkout), otherwise [] so esbuild uses the `default`/dist entry. The
    // probe finds todl's package.json two ways: the root IS todl (Node package
    // self-reference, in-repo), or todl lives under <root>/node_modules. Never throws:
    // an unreadable/absent manifest yields [] (prefer the always-present dist entry).
    private static ResolveConditions(resolutionRoot: string): string[]
    {
        const manifestPath = EsbuildBundler.LocateTodlManifest(resolutionRoot);
        if (manifestPath === undefined) return [];

        try
        {
            const manifest = JSON.parse(readFileSync(manifestPath, EsbuildBundler.ManifestEncoding)) as {
                exports?: Record<string, unknown>;
            };
            const exportsField = manifest.exports;
            if (exportsField === undefined) return [];
            // exports may be a bare conditions object (todl's own shape) or subpath-keyed
            // under '.'; the development target is a package-relative path like
            // "./src/index.ts".
            const dot = (exportsField["."] ?? exportsField) as { import?: { development?: string } };
            // The `?.` chain deliberately guards a value of unknown shape (null/string/object).
            const developmentEntry = dot?.import?.development;
            if (typeof developmentEntry !== "string") return [];

            const packageDir = dirname(manifestPath);
            const target = join(packageDir, developmentEntry);
            return existsSync(target) ? [EsbuildBundler.DevelopmentCondition] : [];
        }
        catch
        {
            return [];
        }
    }

    // Locates the todl package.json reachable from resolutionRoot: the root itself when
    // it is the todl package (self-reference), else <root>/node_modules/@pragmatic-tech-ai/todl.
    private static LocateTodlManifest(resolutionRoot: string): string | undefined
    {
        const rootManifest = join(resolutionRoot, EsbuildBundler.PackageJsonFile);
        if (existsSync(rootManifest))
        {
            try
            {
                const name = (JSON.parse(readFileSync(rootManifest, EsbuildBundler.ManifestEncoding)) as { name?: string }).name;
                if (name === EsbuildBundler.TodlPackageName) return rootManifest;
            }
            catch
            {
                // fall through to the node_modules lookup
            }
        }

        const installedManifest = join(
            resolutionRoot,
            EsbuildBundler.NodeModulesDirectory,
            EsbuildBundler.ScopedTodlDir,
            EsbuildBundler.PackageJsonFile);
        return existsSync(installedManifest) ? installedManifest : undefined;
    }
}
