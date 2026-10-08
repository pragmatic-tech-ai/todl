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
        assert.match(src, /^import "\.\/src\/main\.js";$/m);
        assert.match(src, /import \{ model \} from "\.\/generated\/data\.js";/);
        assert.match(src, /import \{ TodlAppBootstrap \} from "@pragmatic-tech-ai\/todl";/);
        assert.match(src, /TodlAppBootstrap\.Mount\(app, model\);/);
    });

    test("imports app.mu.js before main.js so Application.current exists", async () =>
    {
        const ctx = contextWith();

        await new EmitEntryAction().Execute(ctx);

        const src = await ctx.Sandbox.ReadText("entry.ts");
        const iApp = src.indexOf("./src/app.mu.js");
        const iMain = src.indexOf("./src/main.js");
        assert.ok(iApp >= 0 && iMain >= 0 && iApp < iMain, "app.mu.js must import before main.js");
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
