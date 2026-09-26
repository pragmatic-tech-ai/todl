import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { DiagnosticSink, Severity } from "../../../build-system-core/diagnostic-sink.js";
import { EmptyPackageSource, libraryManifest } from "../../tests/fakes.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { MuralCompiler } from "../mural-compiler.js";

// Same fixtures as html-bundle/tests/compile-mural-action.test.ts (the logic under
// test here moved out of that action verbatim) — a minimal valid application root,
// and the same source with a deliberately unterminated block for the failure case.
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

describe("MuralCompiler", () =>
{
    test("compiles a project .mu file into compiled/<name>.mu.js in the sandbox and writes nothing to the project", async () =>
    {
        const ctx = contextWith();
        await ctx.Project.WriteText("views/app.mu", ValidAppMu);

        const written = await new MuralCompiler().Compile(ctx);

        assert.deepEqual(written, ["compiled/app.mu.js"]);
        assert.equal(await ctx.Sandbox.Exists("compiled/app.mu.js"), true);
        assert.equal(await ctx.Project.Exists("compiled/app.mu.js"), false);
    });

    test("no .mu files under the project returns an empty array and reports no diagnostic", async () =>
    {
        const ctx = contextWith();

        const written = await new MuralCompiler().Compile(ctx);

        assert.deepEqual(written, []);
        assert.equal(ctx.Diagnostics.Count, 0);
    });

    test("two .mu sources with the same basename in different folders report an Error naming both and return an empty array", async () =>
    {
        const ctx = contextWith();
        // Both map to compiled/app.mu.js — a silent clobber if not guarded.
        await ctx.Project.WriteText("a/app.mu", ValidAppMu);
        await ctx.Project.WriteText("b/app.mu", ValidAppMu);

        const written = await new MuralCompiler().Compile(ctx);

        assert.deepEqual(written, []);
        const error = ctx.Diagnostics.All().find((d) => d.severity === Severity.Error);
        assert.ok(error, "reported an error");
        assert.ok(error!.message.includes("a/app.mu") && error!.message.includes("b/app.mu"),
            "the error names both colliding sources");
    });

    test("a syntax error reports a Severity.Error diagnostic naming the file and does not throw", async () =>
    {
        const ctx = contextWith();
        await ctx.Project.WriteText("views/app.mu", InvalidAppMu);

        let written: readonly string[] = [];
        await assert.doesNotReject(async () => { written = await new MuralCompiler().Compile(ctx); });

        assert.deepEqual(written, []);
        const diagnostics = ctx.Diagnostics.All();
        assert.ok(diagnostics.some((d) => d.severity === Severity.Error && d.message.includes("views/app.mu")));
        assert.equal(await ctx.Sandbox.Exists("compiled/app.mu.js"), false);
    });

    test("returns written paths in sorted order", async () =>
    {
        const ctx = contextWith();
        await ctx.Project.WriteText("b/zeta.mu", ValidAppMu);
        await ctx.Project.WriteText("a/alpha.mu", ValidAppMu);

        const written = await new MuralCompiler().Compile(ctx);

        assert.deepEqual(written, ["compiled/alpha.mu.js", "compiled/zeta.mu.js"]);
    });
});
