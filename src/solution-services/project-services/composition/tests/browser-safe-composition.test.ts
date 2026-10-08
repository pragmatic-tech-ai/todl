import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build, type BuildFailure, type Metafile } from "esbuild";

// Guards the renderer contract: a browser host (Plexus's renderer) imports the
// project-system module and the IStorage publish path from the MAIN barrel, so that
// graph must bundle for esbuild's `browser` platform — which refuses to resolve any
// node builtin — and must never pull in esbuild itself. Mirrors BundleAppAction's
// browser IIFE build (same platform/format/conditions), so a node edge re-entering the
// barrel fails here with the same "Could not resolve node:…" the app bundle would hit.
class BrowserBundleProbe
{
    private static readonly SourceRoot = fileURLToPath(new URL("../../../../", import.meta.url));
    private static readonly NodeSubpathEntry = "./solution-services/project-services/composition/index.ts";
    private static readonly EsbuildPackageMarker = "node_modules/esbuild/";

    // Imports (and uses, so nothing is dropped) exactly what the renderer host consumes.
    public static readonly BarrelEntry = [
        "import { TodlProjectSystemModule, ProjectSystemComposer, BuildSystemRegistryKey,",
        "  TodlProjectBuildManager, LocalNpmRegistry, StoragePackagePacker, WebTgz, TarArchive } from './index.ts';",
        "globalThis.__probe = [TodlProjectSystemModule, ProjectSystemComposer, BuildSystemRegistryKey,",
        "  TodlProjectBuildManager, LocalNpmRegistry, StoragePackagePacker, WebTgz, TarArchive];",
    ].join("\n");

    public static readonly HtmlBundleEntry =
        "import { HtmlBundleBuildSystem } from './solution-services/todl-build-system/html-bundle/html-bundle-build-system.ts'; "
        + "globalThis.__probe = [HtmlBundleBuildSystem];";

    public static readonly NodeSubpathEntryContents =
        `import * as ps from '${BrowserBundleProbe.NodeSubpathEntry}'; globalThis.__probe = ps;`;

    // Bundles `contents` (resolved from src/) for the browser; returns the metafile, or
    // the resolve-error texts if esbuild refused.
    public static async Bundle(contents: string): Promise<{ Metafile?: Metafile; Errors: string[] }>
    {
        try
        {
            const result = await build({
                stdin: { contents, resolveDir: BrowserBundleProbe.SourceRoot, loader: "ts", sourcefile: "probe-entry.ts" },
                bundle: true,
                format: "iife",
                platform: "browser",
                target: "es2020",
                write: false,
                metafile: true,
                logLevel: "silent",
                conditions: ["development"],
            });
            return { Metafile: result.metafile, Errors: [] };
        }
        catch (err)
        {
            const failure = err as BuildFailure;
            return { Errors: (failure.errors ?? []).map((e) => `${e.location?.file ?? "?"}: ${e.text}`) };
        }
    }

    public static EsbuildInputs(metafile: Metafile): string[]
    {
        return Object.keys(metafile.inputs)
            .filter((path) => path.split("\\").join("/").includes(BrowserBundleProbe.EsbuildPackageMarker));
    }
}

describe("browser-safe project-system composition (main barrel)", () =>
{
    test("TodlProjectSystemModule + the IStorage publish path bundle for the browser platform with no node builtin and no esbuild", async () =>
    {
        const { Metafile: metafile, Errors: errors } = await BrowserBundleProbe.Bundle(BrowserBundleProbe.BarrelEntry);

        assert.deepEqual(errors, [], `the main barrel's composition graph reached a node-only module:\n${errors.join("\n")}`);
        assert.ok(metafile !== undefined);
        assert.deepEqual(BrowserBundleProbe.EsbuildInputs(metafile), [], "esbuild must not be bundled into the browser graph");
    });

    test("HtmlBundleBuildSystem (with BundleAppAction) bundles for the browser with no node builtin and no esbuild", async () =>
    {
        const { Metafile: metafile, Errors: errors } = await BrowserBundleProbe.Bundle(BrowserBundleProbe.HtmlBundleEntry);

        assert.deepEqual(errors, [], `HtmlBundleBuildSystem reached a node-only module:\n${errors.join("\n")}`);
        assert.ok(metafile !== undefined);
        assert.deepEqual(BrowserBundleProbe.EsbuildInputs(metafile), [], "esbuild must not be bundled into the browser graph");
    });

    test("control: the node-only ./project-system subpath (html-bundle) does NOT bundle for the browser", async () =>
    {
        // Proves the probe actually detects node edges — if this ever passes, the guard
        // above is vacuous.
        const { Errors: errors } = await BrowserBundleProbe.Bundle(BrowserBundleProbe.NodeSubpathEntryContents);

        assert.ok(errors.length > 0, "expected node builtins to be unresolvable on the browser platform");
        assert.ok(errors.some((e) => /Could not resolve "(node:)?[a-z_/]+"/.test(e)), errors.join("\n"));
    });
});
