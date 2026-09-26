import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { DiagnosticSink, Severity } from "../../../build-system-core/diagnostic-sink.js";
import { EmptyPackageSource, libraryManifest } from "../../tests/fakes.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { NpmArtifacts } from "../npm-artifacts.js";
import { CompileMuralAction } from "../compile-mural-action.js";

// Same fixture as html-bundle's CompileMuralAction test (compile-mural-action.test.ts):
// a minimal valid application root — an Application whose resources carry a single
// x:root visual.
const ValidAppMu = "Application { resources: { Border x:root {} } }\n";

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

describe("CompileMuralAction (npm)", () =>
{
    test("compiles project .mu into the sandbox and records paths under NpmArtifacts.CompiledMural", async () =>
    {
        const ctx = contextWith();
        await ctx.Project.WriteText("lib.mu", ValidAppMu);

        await new CompileMuralAction().Execute(ctx);

        assert.deepEqual(ctx.Artifacts.Get(NpmArtifacts.CompiledMural), ["compiled/lib.mu.js"]);
    });

    test("no .mu files -> NpmArtifacts.CompiledMural is [], no error", async () =>
    {
        const ctx = contextWith();

        await assert.doesNotReject(() => new CompileMuralAction().Execute(ctx));

        assert.deepEqual(ctx.Artifacts.Get(NpmArtifacts.CompiledMural), []);
    });

    test("a basename collision reports an Error and leaves NpmArtifacts.CompiledMural unset", async () =>
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
        assert.equal(ctx.Artifacts.Get(NpmArtifacts.CompiledMural), undefined);
    });
});
