import { test, describe } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { DiagnosticSink, Severity } from "../../../build-system-core/diagnostic-sink.js";
import { EmptyPackageSource, libraryManifest } from "../../tests/fakes.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { HtmlArtifacts } from "../html-artifacts.js";
import { BundleAppAction } from "../bundle-app-action.js";

// A distinctive class name the test's generated model DTO declares, so its survival
// (as a substring) in the emitted bundle proves esbuild `keepNames` preserved the
// original source name through bundling — the same intent as the removed
// graph-app-bundle-keepnames.test.ts, which asserted `__name(` is present.
const SentinelClass = "KeepNamesSentinelDto";

// A minimal generated entry that exercises all three resolution kinds the real
// generated/entry.ts uses: the bare todl package (self-referenced from the repo,
// resolving TodlAppBootstrap), the compiled app root one dir over, and the local
// model DTO next to it.
const EntrySource =
    `import { TodlAppBootstrap } from "@pragmatic-tech-ai/todl";\n` +
    `import { app } from "../compiled/app.mu.js";\n` +
    `import { ${SentinelClass} } from "./model.js";\n` +
    `const dto = ${SentinelClass}.FromJSON((window as any).__TODL_APP__);\n` +
    `console.log(TodlAppBootstrap, app, dto);\n`;

const ModelSource =
    `export class ${SentinelClass}\n` +
    `{\n` +
    `    public static FromJSON(_json: unknown): ${SentinelClass}\n` +
    `    {\n` +
    `        return new ${SentinelClass}();\n` +
    `    }\n` +
    `}\n`;

// A stub compiled app root standing in for a mural-compiled .mu module: the entry
// imports its `app` export, and its `export const app` marks it the application root.
const CompiledAppRoot = `export const app = {};\n`;

const EntryPath = "generated/entry.ts";
const ModelPath = "generated/model.ts";
const CompiledAppPath = "compiled/app.mu.js";

function contextWith(): TodlBuildContext
{
    return {
        Project: new FakeStorage(),
        Sandbox: new FakeStorage(),
        Artifacts: new BuildArtifacts(),
        Source: new EmptyPackageSource(),
        Manifest: libraryManifest(),
        Options: {},
        Diagnostics: new DiagnosticSink(),
    };
}

async function stageValidInputs(ctx: TodlBuildContext): Promise<void>
{
    // entry.ts is build glue emitted by EmitEntryAction into ctx.Sandbox (Task 10), not
    // part of the project's generated/ tree. generated/model.ts is required project
    // content (a generator's output, Task 11) — BundleAppAction never reads it as an
    // artifact, but stages it from ctx.Project because the entry imports it by path.
    await ctx.Sandbox.WriteText(EntryPath, EntrySource);
    await ctx.Project.WriteText(ModelPath, ModelSource);
    await ctx.Sandbox.WriteText(CompiledAppPath, CompiledAppRoot);
    ctx.Artifacts.Set(HtmlArtifacts.AppEntry, EntryPath);
    ctx.Artifacts.Set(HtmlArtifacts.CompiledUi, [CompiledAppPath]);
}

describe("BundleAppAction", () =>
{
    test("bundles the staged entry into a keepNames IIFE resolving todl + local imports across stores", async () =>
    {
        const ctx = contextWith();
        await stageValidInputs(ctx);

        await new BundleAppAction().Execute(ctx);

        assert.equal(ctx.Diagnostics.Count, 0, JSON.stringify(ctx.Diagnostics.All()));
        const bundle = ctx.Artifacts.Get(HtmlArtifacts.AppBundle);
        assert.equal(typeof bundle, "string");
        assert.ok(bundle!.length > 0, "bundle is a non-empty string");
        // esbuild's iife format wraps the module in an immediately-invoked closure.
        assert.match(bundle!, /\(\(\) => \{/, "output is an IIFE");
        assert.match(bundle!, /\}\)\(\);\s*$/, "output closes the IIFE");
        // keepNames: esbuild emits `__name(...)` calls only when keepNames is active,
        // and the original source class name survives as a substring.
        assert.ok(bundle!.includes("__name("), "keepNames is active");
        assert.ok(bundle!.includes(SentinelClass), "original class name survives bundling unmangled");
    });

    test("a bundle failure reports a Severity.Error diagnostic and does not throw", async () =>
    {
        const ctx = contextWith();
        // Entry imports a module that does not exist anywhere — esbuild fails to resolve it.
        await ctx.Sandbox.WriteText(EntryPath, `import "./does-not-exist.js";\n`);
        await ctx.Sandbox.WriteText(CompiledAppPath, CompiledAppRoot);
        ctx.Artifacts.Set(HtmlArtifacts.AppEntry, EntryPath);
        ctx.Artifacts.Set(HtmlArtifacts.CompiledUi, [CompiledAppPath]);

        await assert.doesNotReject(() => new BundleAppAction().Execute(ctx));

        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.AppBundle), undefined);
        assert.ok(ctx.Diagnostics.All().some((d) => d.severity === Severity.Error));
    });

    test("a missing compiled app root reports a Severity.Error and produces no bundle", async () =>
    {
        const ctx = contextWith();
        await ctx.Sandbox.WriteText(EntryPath, EntrySource);
        ctx.Artifacts.Set(HtmlArtifacts.AppEntry, EntryPath);
        // CompiledUi carries a module, but not the required compiled/app.mu.js root.
        await ctx.Sandbox.WriteText("compiled/resources.mu.js", `export const resources = {};\n`);
        ctx.Artifacts.Set(HtmlArtifacts.CompiledUi, ["compiled/resources.mu.js"]);

        await new BundleAppAction().Execute(ctx);

        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.AppBundle), undefined);
        assert.ok(ctx.Diagnostics.All().some((d) => d.severity === Severity.Error));
    });

    test("more than one application root reports a Severity.Error naming the candidates", async () =>
    {
        const ctx = contextWith();
        await ctx.Sandbox.WriteText(EntryPath, EntrySource);
        ctx.Artifacts.Set(HtmlArtifacts.AppEntry, EntryPath);
        await ctx.Sandbox.WriteText(CompiledAppPath, CompiledAppRoot);
        await ctx.Sandbox.WriteText("compiled/other.mu.js", CompiledAppRoot);
        ctx.Artifacts.Set(HtmlArtifacts.CompiledUi, [CompiledAppPath, "compiled/other.mu.js"]);

        await new BundleAppAction().Execute(ctx);

        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.AppBundle), undefined);
        const error = ctx.Diagnostics.All().find((d) => d.severity === Severity.Error);
        assert.ok(error, "reported an error");
        assert.ok(error!.message.includes(CompiledAppPath) && error!.message.includes("compiled/other.mu.js"),
            "the error names both application-root candidates");
    });

    test("a module whose export name merely starts with 'app' is not counted as a second root", async () =>
    {
        const ctx = contextWith();
        await stageValidInputs(ctx);
        // A sibling compiled module exporting `appBar` (not `app`): its JS contains the
        // substring "export const app" but is NOT an application root. The word-boundary
        // marker must not miscount it, so the single-root bundle still succeeds.
        await ctx.Sandbox.WriteText("compiled/app-bar.mu.js", `export const appBar = {};\n`);
        ctx.Artifacts.Set(HtmlArtifacts.CompiledUi, [CompiledAppPath, "compiled/app-bar.mu.js"]);

        await new BundleAppAction().Execute(ctx);

        assert.equal(ctx.Diagnostics.Count, 0, JSON.stringify(ctx.Diagnostics.All()));
        assert.equal(typeof ctx.Artifacts.Get(HtmlArtifacts.AppBundle), "string");
    });
});

// --- Spec B: condition selection by development-entry presence ---

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

    // Source checkout: root IS todl, src/index.ts present.
    public static WriteSourceCheckout(root: string): void
    {
        ResolveConditionsFixture.WritePackageJson(root, ResolveConditionsFixture.ExportsConditions());
        mkdirSync(join(root, ResolveConditionsFixture.SrcDir), { recursive: true });
        writeFileSync(join(root, ResolveConditionsFixture.SrcDir, ResolveConditionsFixture.SrcEntryFile), ResolveConditionsFixture.StubSource);
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
        return (BundleAppAction as unknown as { ResolveConditions(r: string): string[] }).ResolveConditions(root);
    }
}

describe("BundleAppAction.ResolveConditions", () =>
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
