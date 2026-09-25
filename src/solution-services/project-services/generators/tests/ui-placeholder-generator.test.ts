import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { check } from "../../../../compiler-services/api.js";
import { fromJSON, toJSON } from "../../../../compiler-services/emit/json.js";
import { AppUiTemplate } from "../../../todl-build-system/html-bundle/app-ui-template.js";
import { DiagnosticSink } from "../../../build-system-core/diagnostic-sink.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import type { CompiledPackage } from "../../../../publish/publish.js";
import { GeneratorTrigger, type GeneratorContext, type IProjectModelProvider, type ProjectModel } from "../project-content-generator.js";
import { UiPlaceholderGenerator } from "../ui-placeholder-generator.js";

const WIDGET_MODEL = "namespace acme { concept Widget { label : string?; } }";
const OUTPUT_FILE = "generated/app.mu";
const HAND_AUTHORED_CONTENT = "// mine";

class FakeModelProvider implements IProjectModelProvider
{
    public constructor(private readonly result: ProjectModel)
    {
    }

    public Compile(): Promise<ProjectModel>
    {
        return Promise.resolve(this.result);
    }
}

function widgetManifest(): ProjectManifest
{
    return { type: ProjectType.Architecture, name: "Widgets", version: 1 };
}

function contextFor(model: IProjectModelProvider, project: FakeStorage, diagnostics: DiagnosticSink): GeneratorContext
{
    return { Project: project, Manifest: widgetManifest(), Model: model, Diagnostics: diagnostics, Reason: GeneratorTrigger.ProjectCreated };
}

describe("UiPlaceholderGenerator.Generate", () =>
{
    test("writes the placeholder once", async () =>
    {
        const doc = toJSON(check([{ uri: "m.todl", text: WIDGET_MODEL }]).model);
        const pkg = { fullDocument: doc } as unknown as CompiledPackage;
        const model = new FakeModelProvider({ package: pkg, errors: [] });
        const project = new FakeStorage();
        const diagnostics = new DiagnosticSink();
        const generator = new UiPlaceholderGenerator();

        const result = await generator.Generate(contextFor(model, project, diagnostics));

        const expected = AppUiTemplate.Render(fromJSON(doc));
        const written = await project.ReadText(OUTPUT_FILE);
        assert.equal(written, expected);
        assert.ok(written.startsWith(AppUiTemplate.GeneratedMarker));
        assert.ok(result.Written.includes(OUTPUT_FILE));
        assert.equal(result.Skipped.length, 0);
    });

    test("WriteOnce no-clobber: does not overwrite an existing file (Review Focus)", async () =>
    {
        const doc = toJSON(check([{ uri: "m.todl", text: WIDGET_MODEL }]).model);
        const pkg = { fullDocument: doc } as unknown as CompiledPackage;
        const model = new FakeModelProvider({ package: pkg, errors: [] });
        const project = new FakeStorage();
        await project.WriteText(OUTPUT_FILE, HAND_AUTHORED_CONTENT);
        const diagnostics = new DiagnosticSink();
        const generator = new UiPlaceholderGenerator();

        const result = await generator.Generate(contextFor(model, project, diagnostics));

        assert.equal(await project.ReadText(OUTPUT_FILE), HAND_AUTHORED_CONTENT);
        assert.ok(result.Skipped.includes(OUTPUT_FILE));
        assert.equal(result.Written.length, 0);
    });
});
