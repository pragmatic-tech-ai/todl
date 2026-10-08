import { test, describe } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Severity } from "../../../../build-system-core/diagnostic-sink.js";
import { EsbuildBundler } from "../esbuild-bundler.js";

class ResolveConditionsFixture
{
    private static readonly RootPrefix = "todl-resolve-conditions-";
    private static readonly PackageJson = "package.json";
    private static readonly TodlName = "@pragmatic-tech-ai/todl";
    private static readonly OtherName = "something-else";
    private static readonly Scope = "@pragmatic-tech-ai";
    private static readonly PackageDirName = "todl";
    private static readonly NodeModules = "node_modules";
    private static readonly SrcDir = "src";
    private static readonly DistDir = "dist";
    private static readonly SrcEntryFile = "index.ts";
    private static readonly DistEntryFile = "index.js";
    private static readonly DevelopmentCondition = "development";
    private static readonly SrcEntryPath = "./src/index.ts";
    private static readonly DistEntryPath = "./dist/index.js";
    private static readonly InvalidJson = "{ not valid json";
    private static readonly StubSource = "export const x = 1;\n";

    public static get Development(): string
    {
        return ResolveConditionsFixture.DevelopmentCondition;
    }

    public static ExportsConditions(): unknown
    {
        return {
            import: {
                [ResolveConditionsFixture.DevelopmentCondition]: ResolveConditionsFixture.SrcEntryPath,
                default: ResolveConditionsFixture.DistEntryPath,
            },
        };
    }

    // Source checkout: root IS todl, src/index.ts present. Mirrors the real todl
    // package.json: exports is '.'-nested. `dotNested: false` instead writes a bare
    // conditions object (exports-shape variance, e.g. a third-party consumer).
    public static WriteSourceCheckout(root: string, dotNested: boolean = true): void
    {
        const conditions = ResolveConditionsFixture.ExportsConditions();
        ResolveConditionsFixture.WritePackageJson(root, dotNested ? { ".": conditions } : conditions);
        mkdirSync(join(root, ResolveConditionsFixture.SrcDir), { recursive: true });
        writeFileSync(join(root, ResolveConditionsFixture.SrcDir, ResolveConditionsFixture.SrcEntryFile), ResolveConditionsFixture.StubSource);
    }

    // Root IS todl but its package.json is not valid JSON.
    public static WriteUnparseablePackageJson(root: string): void
    {
        writeFileSync(join(root, ResolveConditionsFixture.PackageJson), ResolveConditionsFixture.InvalidJson);
    }

    // Root IS todl; exports declares only a `default` target (no development key).
    public static WriteNoDevelopmentKey(root: string): void
    {
        ResolveConditionsFixture.WritePackageJson(
            root,
            { ".": { import: { default: ResolveConditionsFixture.DistEntryPath } } });
    }

    // Installed shape: todl under node_modules, '.' subkey exports, dist only.
    public static WriteInstalledDistOnly(root: string): void
    {
        const pkg = join(root, ResolveConditionsFixture.NodeModules, ResolveConditionsFixture.Scope, ResolveConditionsFixture.PackageDirName);
        ResolveConditionsFixture.WritePackageJson(pkg, { ".": ResolveConditionsFixture.ExportsConditions() });
        mkdirSync(join(pkg, ResolveConditionsFixture.DistDir), { recursive: true });
        writeFileSync(join(pkg, ResolveConditionsFixture.DistDir, ResolveConditionsFixture.DistEntryFile), ResolveConditionsFixture.StubSource);
    }

    // Builds a throwaway resolution-root directory; callers tear it down in a finally.
    public static MakeRoot(): string
    {
        return mkdtempSync(join(tmpdir(), ResolveConditionsFixture.RootPrefix));
    }

    public static WritePackageJson(dir: string, exportsField: unknown): void
    {
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, ResolveConditionsFixture.PackageJson),
            JSON.stringify({ name: ResolveConditionsFixture.TodlName, exports: exportsField }));
    }

    public static WriteOtherPackageJson(dir: string): void
    {
        writeFileSync(join(dir, ResolveConditionsFixture.PackageJson), JSON.stringify({ name: ResolveConditionsFixture.OtherName }));
    }

    // Reaches the private static under test. A cast is the honest way to unit-test a
    // private helper whose behavior the spec singles out; the method stays private.
    public static Resolve(root: string): string[]
    {
        return (EsbuildBundler as unknown as { ResolveConditions(r: string): string[] }).ResolveConditions(root);
    }
}

describe("EsbuildBundler.ResolveConditions", () =>
{
    test("source checkout (self-reference root with src present) selects the development condition", () =>
    {
        const root = ResolveConditionsFixture.MakeRoot();
        try
        {
            ResolveConditionsFixture.WriteSourceCheckout(root);

            assert.deepEqual(ResolveConditionsFixture.Resolve(root), [ResolveConditionsFixture.Development]);
        }
        finally
        {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test("bare-conditions exports shape (third-party consumer variance) with src present selects development", () =>
    {
        const root = ResolveConditionsFixture.MakeRoot();
        try
        {
            ResolveConditionsFixture.WriteSourceCheckout(root, false);

            assert.deepEqual(ResolveConditionsFixture.Resolve(root), [ResolveConditionsFixture.Development]);
        }
        finally
        {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test("unparseable todl package.json does not throw and selects no condition", () =>
    {
        const root = ResolveConditionsFixture.MakeRoot();
        try
        {
            ResolveConditionsFixture.WriteUnparseablePackageJson(root);

            assert.deepEqual(ResolveConditionsFixture.Resolve(root), []);
        }
        finally
        {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test("exports with no development key selects no condition", () =>
    {
        const root = ResolveConditionsFixture.MakeRoot();
        try
        {
            ResolveConditionsFixture.WriteNoDevelopmentKey(root);

            assert.deepEqual(ResolveConditionsFixture.Resolve(root), []);
        }
        finally
        {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test("installed dist-only todl (node_modules, no src) selects no condition", () =>
    {
        const root = ResolveConditionsFixture.MakeRoot();
        try
        {
            ResolveConditionsFixture.WriteInstalledDistOnly(root);

            assert.deepEqual(ResolveConditionsFixture.Resolve(root), []);
        }
        finally
        {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test("no todl package.json under the root does not throw and selects no condition", () =>
    {
        const root = ResolveConditionsFixture.MakeRoot();
        try
        {
            ResolveConditionsFixture.WriteOtherPackageJson(root);
            assert.deepEqual(ResolveConditionsFixture.Resolve(root), []);
        }
        finally
        {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

// An EsbuildBundler whose resolution root is a caller-supplied fixture dir, so a test
// can stage a dist-only @pragmatic-tech-ai/todl there instead of the real checkout.
class RootOverrideEsbuildBundler extends EsbuildBundler
{
    constructor(private readonly root: string)
    {
        super();
    }

    protected override ResolutionRoot(): string | undefined
    {
        return this.root;
    }
}

class DistOnlyBundleFixture
{
    private static readonly RootPrefix = "todl-dist-only-bundle-";
    private static readonly NodeModules = "node_modules";
    private static readonly PackageName = "@pragmatic-tech-ai/todl";
    public static readonly Marker = "__DistOnlyMarker__";
    private static readonly PackageJson = "package.json";
    private static readonly DistDir = "dist";
    private static readonly DistEntryFile = "index.js";
    private static readonly ModuleType = "module";
    private static readonly SrcEntryPath = "./src/index.ts";
    private static readonly DistEntryPath = "./dist/index.js";
    private static readonly DevelopmentCondition = "development";
    private static readonly DistEntrySource = `export const TodlAppBootstrap = { tag: "${DistOnlyBundleFixture.Marker}" };\n`;

    public static MakeRoot(): string
    {
        return mkdtempSync(join(tmpdir(), DistOnlyBundleFixture.RootPrefix));
    }

    // A dist-only @pragmatic-tech-ai/todl: package.json declares both conditions but
    // ships ONLY dist — exactly a published install. The dist entry exports the single
    // symbol the generated entry imports (TodlAppBootstrap).
    public static WriteDistOnlyTodl(root: string): void
    {
        const pkg = join(root, DistOnlyBundleFixture.NodeModules, ...DistOnlyBundleFixture.PackageName.split("/"));
        mkdirSync(join(pkg, DistOnlyBundleFixture.DistDir), { recursive: true });
        writeFileSync(
            join(pkg, DistOnlyBundleFixture.PackageJson),
            JSON.stringify({
                name: DistOnlyBundleFixture.PackageName,
                type: DistOnlyBundleFixture.ModuleType,
                exports: {
                    import: {
                        [DistOnlyBundleFixture.DevelopmentCondition]: DistOnlyBundleFixture.SrcEntryPath,
                        default: DistOnlyBundleFixture.DistEntryPath,
                    },
                },
            }));
        writeFileSync(join(pkg, DistOnlyBundleFixture.DistDir, DistOnlyBundleFixture.DistEntryFile), DistOnlyBundleFixture.DistEntrySource);
    }
}

describe("EsbuildBundler dist-only resolution (integration)", () =>
{
    test("bundles against a dist-only todl (no src) by resolving the default/dist export", async () =>
    {
        const root = DistOnlyBundleFixture.MakeRoot();
        try
        {
            DistOnlyBundleFixture.WriteDistOnlyTodl(root);

            const result = await new RootOverrideEsbuildBundler(root).BundleApp({
                Entry: "entry.js",
                Files: [{
                    Path: "entry.js",
                    Text: 'import { TodlAppBootstrap } from "@pragmatic-tech-ai/todl";\nconsole.log(TodlAppBootstrap);\n',
                }],
            });

            assert.equal(result.Diagnostics.length, 0, JSON.stringify(result.Diagnostics));
            assert.ok((result.Text ?? "").length > 0, "produced a non-empty bundle against dist-only todl");
            assert.match(result.Text!, /\(\(\) => \{/, "output is an IIFE");
            assert.ok(result.Text!.includes(DistOnlyBundleFixture.Marker), "bundle came from the dist stub (default -> dist/index.js)");
        }
        finally
        {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("EsbuildBundler", () =>
{
    test("bundles a staged entry to IIFE text", async () =>
    {
        const result = await new EsbuildBundler().BundleApp({
            Entry: "entry.js",
            Files: [{ Path: "entry.js", Text: "export const app = 1;\n" }],
        });
        assert.equal(result.Diagnostics.length, 0, JSON.stringify(result.Diagnostics));
        assert.match(result.Text ?? "", /\(\(\)\s*=>|\(function/);
    });

    test("a bundle failure maps to a Severity.Error diagnostic and does not throw", async () =>
    {
        const bundler = new EsbuildBundler();
        const request = {
            Entry: "entry.js",
            Files: [{ Path: "entry.js", Text: 'import "totally-nonexistent-bare-pkg-xyz";\n' }],
        };
        await assert.doesNotReject(() => bundler.BundleApp(request));
        const result = await bundler.BundleApp(request);
        assert.equal(result.Text, undefined);
        assert.ok(result.Diagnostics.length >= 1);
        assert.equal(result.Diagnostics[0]!.severity, Severity.Error);
        assert.ok(result.Diagnostics[0]!.message.startsWith("failed to bundle the app: "));
    });
});
