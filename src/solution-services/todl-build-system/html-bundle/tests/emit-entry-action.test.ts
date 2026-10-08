import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { DiagnosticSink } from "../../../build-system-core/diagnostic-sink.js";
import { EmptyPackageSource } from "../../tests/fakes.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { HtmlArtifacts } from "../html-artifacts.js";
import { EmitEntryAction } from "../emit-entry-action.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";

function widgetManifest(): ProjectManifest
{
    return { type: ProjectType.Architecture, name: "widget", id: "widget", version: 1 };
}

function contextWith(): TodlBuildContext
{
    return {
        Project: new FakeStorage(),
        Sandbox: new FakeStorage(),
        Artifacts: new BuildArtifacts(),
        Source: new EmptyPackageSource(),
        Manifest: widgetManifest(),
        Options: {},
        Diagnostics: new DiagnosticSink(),
    };
}

describe("EmitEntryAction", () =>
{
    test("writes entry.ts into the sandbox (not the project) with the exact entry lines", async () =>
    {
        const ctx = contextWith();

        await new EmitEntryAction().Execute(ctx);

        assert.equal(await ctx.Sandbox.Exists("entry.ts"), true);
        assert.equal(await ctx.Project.Exists("entry.ts"), false);
        const src = await ctx.Sandbox.ReadText("entry.ts");
        assert.match(src, /import \{ app \} from "\.\/src\/app\.mu\.js";/);
        assert.match(src, /import \{ Widget\w*App \} from "\.\/src\/main\.js";/);
        assert.match(src, /import \{ model \} from "\.\/generated\/data\.js";/);
        assert.match(src, /import \{ TodlAppBootstrap \} from "@pragmatic-tech-ai\/todl";/);
        assert.match(src, /TodlAppBootstrap\.Mount\(app, model\);/);
    });

    test("imports app.mu.js before instantiating the VM, and instantiates before Mount", async () =>
    {
        const ctx = contextWith();

        await new EmitEntryAction().Execute(ctx);

        const src = await ctx.Sandbox.ReadText("entry.ts");
        const iApp = src.indexOf(`import { app } from "./src/app.mu.js"`);
        const iNew = src.indexOf("new WidgetApp()");
        const iMount = src.indexOf("TodlAppBootstrap.Mount(app, model)");
        assert.ok(iApp === 0, "app.mu.js import must be first");
        assert.ok(iApp < iNew, "app.mu.js must import before the VM is constructed");
        assert.ok(iNew >= 0 && iNew < iMount, "VM must be constructed before Mount");
    });

    test("derives the VM class name from manifest id, not name", async () =>
    {
        const ctx = contextWith();
        ctx.Manifest = { type: ProjectType.Architecture, name: "my_proj", id: "real_id", version: 1 };

        await new EmitEntryAction().Execute(ctx);

        const src = await ctx.Sandbox.ReadText("entry.ts");
        assert.match(src, /import \{ RealIdApp \} from "\.\/src\/main\.js";/);
        assert.match(src, /^new RealIdApp\(\);$/m);
        assert.doesNotMatch(src, /MyProjApp/);
    });

    test("records the sandbox-relative path under HtmlArtifacts.AppEntry", async () =>
    {
        const ctx = contextWith();

        await new EmitEntryAction().Execute(ctx);

        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.AppEntry), "entry.ts");
    });

    test("reports no diagnostics", async () =>
    {
        const ctx = contextWith();

        await new EmitEntryAction().Execute(ctx);

        assert.equal(ctx.Diagnostics.Count, 0);
    });
});
