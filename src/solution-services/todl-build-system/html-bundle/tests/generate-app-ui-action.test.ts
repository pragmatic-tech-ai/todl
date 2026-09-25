import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { DiagnosticSink } from "../../../build-system-core/diagnostic-sink.js";
import { EmptyPackageSource, libraryManifest } from "../../tests/fakes.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { NpmArtifacts } from "../../npm/npm-artifacts.js";
import { GenerateAppUiAction } from "../generate-app-ui-action.js";
import { AppUiTemplate } from "../app-ui-template.js";
import { Repository } from "../../../../compiler-services/model/model.js";
import { toJSON } from "../../../../compiler-services/emit/json.js";
import type { CompiledPackage } from "../../../../publish/publish.js";

const OutputFile = "generated/app.mu";

function widgetRepo(): Repository
{
    const r = new Repository();
    const b = r.builder();
    b.definePrimitive("string");
    b.defineConcept("widget");
    b.addField("widget", "label", "string");
    b.commit();
    return r;
}

function compiledPackage(): CompiledPackage
{
    return {
        id: "demo-lib",
        version: "0.1.0",
        document: { nodes: [], edges: [] },
        fullDocument: toJSON(widgetRepo()),
        sources: [],
        classes: [],
    } as unknown as CompiledPackage;
}

function contextWith(pkg: CompiledPackage | undefined): TodlBuildContext
{
    const artifacts = new BuildArtifacts();
    if (pkg !== undefined) artifacts.Set(NpmArtifacts.CompiledModel, pkg);
    return {
        Project: new FakeStorage(),
        Sandbox: new FakeStorage(),
        Artifacts: artifacts,
        Source: new EmptyPackageSource(),
        Manifest: libraryManifest(),
        Options: {},
        Diagnostics: new DiagnosticSink(),
    };
}

describe("GenerateAppUiAction", () =>
{
    test("writes generated/app.mu into the project with x:root and a concept collection binding", async () =>
    {
        const ctx = contextWith(compiledPackage());

        await new GenerateAppUiAction().Execute(ctx);

        assert.equal(await ctx.Project.Exists(OutputFile), true);
        const src = await ctx.Project.ReadText(OutputFile);
        assert.match(src, /x:root/);
        assert.match(src, /Application \{/);
        assert.match(src, /ItemsSource = \$widgets/);
    });

    test("reports a diagnostic and writes nothing when there is no compiled model", async () =>
    {
        const ctx = contextWith(undefined);

        await new GenerateAppUiAction().Execute(ctx);

        assert.equal(await ctx.Project.Exists(OutputFile), false);
        assert.ok(ctx.Diagnostics.Count > 0);
    });

    test("clobber guard: a hand-authored file (no generated marker) is left untouched", async () =>
    {
        const ctx = contextWith(compiledPackage());
        const handAuthored = "// hand-authored, do not regenerate\nApplication { resources: { Border x:root {} } }\n";
        await ctx.Project.WriteText(OutputFile, handAuthored);

        await new GenerateAppUiAction().Execute(ctx);

        const src = await ctx.Project.ReadText(OutputFile);
        assert.equal(src, handAuthored);
        const diagnostics = ctx.Diagnostics.All();
        assert.ok(diagnostics.some((d) => d.message.includes("hand-authored")));
    });

    test("clobber guard: a previously-generated file (marker present) IS overwritten", async () =>
    {
        const ctx = contextWith(compiledPackage());
        await ctx.Project.WriteText(OutputFile, `${AppUiTemplate.GeneratedMarker}\nstale content\n`);

        await new GenerateAppUiAction().Execute(ctx);

        const src = await ctx.Project.ReadText(OutputFile);
        assert.match(src, /ItemsSource = \$widgets/);
        assert.doesNotMatch(src, /stale content/);
    });

    test("no diagnostic is reported on the happy path", async () =>
    {
        const ctx = contextWith(compiledPackage());

        await new GenerateAppUiAction().Execute(ctx);

        assert.equal(ctx.Diagnostics.Count, 0);
    });
});
