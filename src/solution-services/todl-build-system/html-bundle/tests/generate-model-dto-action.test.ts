import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { DiagnosticSink } from "../../../build-system-core/diagnostic-sink.js";
import { EmptyPackageSource, libraryManifest } from "../../tests/fakes.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { NpmArtifacts } from "../../npm/npm-artifacts.js";
import { HtmlArtifacts } from "../html-artifacts.js";
import { GenerateModelDtoAction } from "../generate-model-dto-action.js";
import { Repository } from "../../../../compiler-services/model/model.js";
import { toJSON } from "../../../../compiler-services/emit/json.js";
import type { CompiledPackage } from "../../../../publish/publish.js";

// A single "widget" concept with a scalar field — enough for generateReadClient
// to emit a non-trivial package class + entity class.
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

describe("GenerateModelDtoAction", () =>
{
    test("writes generated/model.ts into the project with a typed package class", async () =>
    {
        const ctx = contextWith(compiledPackage());

        await new GenerateModelDtoAction().Execute(ctx);

        assert.equal(await ctx.Project.Exists("generated/model.ts"), true);
        const src = await ctx.Project.ReadText("generated/model.ts");
        assert.match(src, /export class DemoLib extends ModelDataSource/);
    });

    test("records the written path under HtmlArtifacts.GeneratedDto", async () =>
    {
        const ctx = contextWith(compiledPackage());

        await new GenerateModelDtoAction().Execute(ctx);

        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.GeneratedDto), "generated/model.ts");
    });

    test("reports a diagnostic and writes nothing when there is no compiled model", async () =>
    {
        const ctx = contextWith(undefined);

        await new GenerateModelDtoAction().Execute(ctx);

        assert.equal(await ctx.Project.Exists("generated/model.ts"), false);
        assert.ok(ctx.Diagnostics.Count > 0);
    });
});
