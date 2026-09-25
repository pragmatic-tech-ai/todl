import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { DiagnosticSink, Severity } from "../../../build-system-core/diagnostic-sink.js";
import { EmptyPackageSource, libraryManifest } from "../../tests/fakes.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { HtmlArtifacts } from "../html-artifacts.js";
import { CompileMuralAction } from "../compile-mural-action.js";

// Minimal valid application root — same shape used by GenerateAppUiAction's own
// hand-authored fixture (generate-app-ui-action.test.ts): an Application whose
// resources carry a single x:root visual.
const ValidAppMu = "Application { resources: { Border x:root {} } }\n";
const InvalidAppMu = "Application { resources: { Border x:root { \n";

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

describe("CompileMuralAction", () =>
{
    test("compiles a project .mu file into compiled/<name>.mu.js in the sandbox", async () =>
    {
        const ctx = contextWith();
        await ctx.Project.WriteText("generated/app.mu", ValidAppMu);

        await new CompileMuralAction().Execute(ctx);

        assert.equal(await ctx.Sandbox.Exists("compiled/app.mu.js"), true);
        const js = await ctx.Sandbox.ReadText("compiled/app.mu.js");
        assert.match(js, /export const app/);
    });

    test("records the written path under HtmlArtifacts.CompiledUi", async () =>
    {
        const ctx = contextWith();
        await ctx.Project.WriteText("generated/app.mu", ValidAppMu);

        await new CompileMuralAction().Execute(ctx);

        assert.deepEqual(ctx.Artifacts.Get(HtmlArtifacts.CompiledUi), ["compiled/app.mu.js"]);
    });

    test("a syntax error reports a Severity.Error diagnostic naming the file and does not throw", async () =>
    {
        const ctx = contextWith();
        await ctx.Project.WriteText("generated/app.mu", InvalidAppMu);

        await assert.doesNotReject(() => new CompileMuralAction().Execute(ctx));

        const diagnostics = ctx.Diagnostics.All();
        assert.ok(diagnostics.some((d) => d.severity === Severity.Error && d.message.includes("generated/app.mu")));
        assert.equal(await ctx.Sandbox.Exists("compiled/app.mu.js"), false);
    });

    test("no diagnostic and no CompiledUi artifact when the project has no .mu files", async () =>
    {
        const ctx = contextWith();

        await new CompileMuralAction().Execute(ctx);

        assert.equal(ctx.Diagnostics.Count, 0);
        assert.deepEqual(ctx.Artifacts.Get(HtmlArtifacts.CompiledUi), []);
    });

    test("two .mu sources with the same basename in different folders report an Error naming both", async () =>
    {
        const ctx = contextWith();
        // Both map to compiled/app.mu.js — a silent clobber if not guarded.
        await ctx.Project.WriteText("a/app.mu", ValidAppMu);
        await ctx.Project.WriteText("b/app.mu", ValidAppMu);

        await assert.doesNotReject(() => new CompileMuralAction().Execute(ctx));

        const error = ctx.Diagnostics.All().find((d) => d.severity === Severity.Error);
        assert.ok(error, "reported an error");
        assert.ok(error!.message.includes("a/app.mu") && error!.message.includes("b/app.mu"),
            "the error names both colliding sources");
        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.CompiledUi), undefined);
    });
});
