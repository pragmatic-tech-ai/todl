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
    test("writes generated/entry.ts into the sandbox (not the project) wiring the compiled app to the DTO package", async () =>
    {
        const ctx = contextWith();

        await new EmitEntryAction().Execute(ctx);

        assert.equal(await ctx.Sandbox.Exists("generated/entry.ts"), true);
        assert.equal(await ctx.Project.Exists("generated/entry.ts"), false);
        const src = await ctx.Sandbox.ReadText("generated/entry.ts");
        assert.match(src, /import \{ app \} from "\.\.\/compiled\/app\.mu\.js";/);
        assert.match(src, /import \{ Widget \} from "\.\/model\.js";/);
        assert.match(src, /import \{ TodlAppBootstrap \} from "@pragmatic-tech-ai\/todl";/);
        assert.match(src, /const dto = Widget\.fromJSON\(\(window as any\)\.__TODL_APP__\);/);
        assert.match(src, /TodlAppBootstrap\.Mount\(app, dto\);/);
    });

    test("records the sandbox-relative path under HtmlArtifacts.AppEntry", async () =>
    {
        const ctx = contextWith();

        await new EmitEntryAction().Execute(ctx);

        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.AppEntry), "generated/entry.ts");
    });

    test("reports no diagnostics", async () =>
    {
        const ctx = contextWith();

        await new EmitEntryAction().Execute(ctx);

        assert.equal(ctx.Diagnostics.Count, 0);
    });
});
