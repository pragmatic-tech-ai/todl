import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { DiagnosticSink } from "../../../build-system-core/diagnostic-sink.js";
import { EmptyPackageSource, libraryManifest } from "../../tests/fakes.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { NpmArtifacts } from "../../npm/npm-artifacts.js";
import { HtmlArtifacts } from "../html-artifacts.js";
import { GenerateEntryAction } from "../generate-entry-action.js";
import { Repository } from "../../../../compiler-services/model/model.js";
import { toJSON } from "../../../../compiler-services/emit/json.js";
import type { CompiledPackage } from "../../../../publish/publish.js";

// A single "widget" concept with a scalar field — enough to exercise the compiled
// model without needing to inspect its content (the entry generator only needs the
// package class name, derived from the manifest id, not the compiled model shape).
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

describe("GenerateEntryAction", () =>
{
    test("writes generated/entry.ts wiring the compiled app to the DTO package", async () =>
    {
        const ctx = contextWith(compiledPackage());

        await new GenerateEntryAction().Execute(ctx);

        assert.equal(await ctx.Project.Exists("generated/entry.ts"), true);
        const src = await ctx.Project.ReadText("generated/entry.ts");
        assert.match(src, /import \{ app \} from "\.\.\/compiled\/app\.mu\.js";/);
        assert.match(src, /import \{ DemoLib \} from "\.\/model\.js";/);
        assert.match(src, /import \{ TodlAppBootstrap \} from "@pragmatic-tech-ai\/todl";/);
        assert.match(src, /const dto = DemoLib\.fromJSON\(\(window as any\)\.__TODL_APP__\);/);
        assert.match(src, /TodlAppBootstrap\.Mount\(app, dto\);/);
    });

    test("records the written path under HtmlArtifacts.AppEntry", async () =>
    {
        const ctx = contextWith(compiledPackage());

        await new GenerateEntryAction().Execute(ctx);

        assert.equal(ctx.Artifacts.Get(HtmlArtifacts.AppEntry), "generated/entry.ts");
    });

    test("reports a diagnostic and writes nothing when there is no compiled model", async () =>
    {
        const ctx = contextWith(undefined);

        await new GenerateEntryAction().Execute(ctx);

        assert.equal(await ctx.Project.Exists("generated/entry.ts"), false);
        assert.ok(ctx.Diagnostics.Count > 0);
    });
});
