import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import type { BundleAppRequest, BundleAppResult, IBundler } from "../../../build-system-core/bundler.js";
import { DiagnosticSink, Severity } from "../../../build-system-core/diagnostic-sink.js";
import { EmptyPackageSource, libraryManifest } from "../../tests/fakes.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { HtmlArtifacts } from "../html-artifacts.js";
import { BundleAppAction } from "../bundle-app-action.js";

const EntrySource = `import { app } from "../compiled/app.mu.js";\nconsole.log(app);\n`;
const ModelSource = `export class Model {}\n`;
const DeepSource = `export class Deep {}\n`;
const CompiledAppRoot = `export const app = {};\n`;

const EntryPath = "generated/entry.ts";
const ModelPath = "generated/model.ts";
const DeepPath = "generated/sub/deep.ts";
const CompiledAppPath = "compiled/app.mu.js";

// A fake IBundler captures the request and returns a canned result (or throws).
class FakeBundler implements IBundler
{
    public Last?: BundleAppRequest;

    constructor(private readonly result: BundleAppResult, private readonly failure?: Error)
    {
    }

    public async BundleApp(request: BundleAppRequest): Promise<BundleAppResult>
    {
        this.Last = request;
        if (this.failure !== undefined) throw this.failure;
        return this.result;
    }
}

class Fixture
{
    public static Context(): TodlBuildContext
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

    public static async StageValidInputs(ctx: TodlBuildContext): Promise<void>
    {
        await ctx.Sandbox.WriteText(EntryPath, EntrySource);
        await ctx.Project.WriteText(ModelPath, ModelSource);
        await ctx.Project.WriteText(DeepPath, DeepSource);
        await ctx.Sandbox.WriteText(CompiledAppPath, CompiledAppRoot);
        ctx.Artifacts.Set(HtmlArtifacts.AppEntry, EntryPath);
        ctx.Artifacts.Set(HtmlArtifacts.CompiledUi, [CompiledAppPath]);
    }

    public static Ok(text: string = "bundle"): FakeBundler
    {
        return new FakeBundler({ Text: text, Diagnostics: [] });
    }
}

describe("BundleAppAction", () =>
{
    test("forwards the entry and the flattened generated tree + compiled modules + entry to the bundler", async () =>
    {
        const ctx = Fixture.Context();
        await Fixture.StageValidInputs(ctx);
        const fake = Fixture.Ok();

        await new BundleAppAction(fake).Execute(ctx);

        assert.ok(fake.Last, "bundler was called");
        assert.equal(fake.Last!.Entry, EntryPath);
        const byPath = new Map(fake.Last!.Files.map((f) => [f.Path, f.Text]));
        assert.equal(byPath.get(ModelPath), ModelSource);
        assert.equal(byPath.get(DeepPath), DeepSource);
        assert.equal(byPath.get(CompiledAppPath), CompiledAppRoot);
        assert.equal(byPath.get(EntryPath), EntrySource);
    });

    test("a Text result is recorded as the app bundle", async () =>
    {
        const ctx = Fixture.Context();
        await Fixture.StageValidInputs(ctx);

        await new BundleAppAction(Fixture.Ok("the-bundle")).Execute(ctx);

        assert.equal(ctx.Diagnostics.Count, 0, JSON.stringify(ctx.Diagnostics.All()));
        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.AppBundle), "the-bundle");
    });

    test("an Error diagnostic result is reported and no bundle is set", async () =>
    {
        const ctx = Fixture.Context();
        await Fixture.StageValidInputs(ctx);
        const fake = new FakeBundler({
            Diagnostics: [{ severity: Severity.Error, message: "boom", source: "esbuild" }],
        });

        await new BundleAppAction(fake).Execute(ctx);

        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.AppBundle), undefined);
        assert.ok(ctx.Diagnostics.All().some((d) => d.severity === Severity.Error && d.message === "boom"));
    });

    test("a throwing bundler is caught and reported (no-throw contract)", async () =>
    {
        const ctx = Fixture.Context();
        await Fixture.StageValidInputs(ctx);
        const fake = new FakeBundler({ Diagnostics: [] }, new Error("kaput"));

        await assert.doesNotReject(() => new BundleAppAction(fake).Execute(ctx));

        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.AppBundle), undefined);
        assert.ok(ctx.Diagnostics.All().some((d) => d.severity === Severity.Error && d.message.includes("kaput")));
    });

    test("a missing compiled app root reports a Severity.Error and produces no bundle", async () =>
    {
        const ctx = Fixture.Context();
        await ctx.Sandbox.WriteText(EntryPath, EntrySource);
        ctx.Artifacts.Set(HtmlArtifacts.AppEntry, EntryPath);
        await ctx.Sandbox.WriteText("compiled/resources.mu.js", `export const resources = {};\n`);
        ctx.Artifacts.Set(HtmlArtifacts.CompiledUi, ["compiled/resources.mu.js"]);
        const fake = Fixture.Ok();

        await new BundleAppAction(fake).Execute(ctx);

        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.AppBundle), undefined);
        assert.equal(fake.Last, undefined);
        assert.ok(ctx.Diagnostics.All().some((d) => d.severity === Severity.Error));
    });

    test("more than one application root reports a Severity.Error naming the candidates", async () =>
    {
        const ctx = Fixture.Context();
        await ctx.Sandbox.WriteText(EntryPath, EntrySource);
        ctx.Artifacts.Set(HtmlArtifacts.AppEntry, EntryPath);
        await ctx.Sandbox.WriteText(CompiledAppPath, CompiledAppRoot);
        await ctx.Sandbox.WriteText("compiled/other.mu.js", CompiledAppRoot);
        ctx.Artifacts.Set(HtmlArtifacts.CompiledUi, [CompiledAppPath, "compiled/other.mu.js"]);

        await new BundleAppAction(Fixture.Ok()).Execute(ctx);

        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.AppBundle), undefined);
        const error = ctx.Diagnostics.All().find((d) => d.severity === Severity.Error);
        assert.ok(error, "reported an error");
        assert.ok(error!.message.includes(CompiledAppPath) && error!.message.includes("compiled/other.mu.js"),
            "the error names both application-root candidates");
    });

    test("a module whose export name merely starts with 'app' is not counted as a second root", async () =>
    {
        const ctx = Fixture.Context();
        await Fixture.StageValidInputs(ctx);
        await ctx.Sandbox.WriteText("compiled/app-bar.mu.js", `export const appBar = {};\n`);
        ctx.Artifacts.Set(HtmlArtifacts.CompiledUi, [CompiledAppPath, "compiled/app-bar.mu.js"]);

        await new BundleAppAction(Fixture.Ok()).Execute(ctx);

        assert.equal(ctx.Diagnostics.Count, 0, JSON.stringify(ctx.Diagnostics.All()));
        assert.equal(typeof ctx.Artifacts.Get(HtmlArtifacts.AppBundle), "string");
    });
});
