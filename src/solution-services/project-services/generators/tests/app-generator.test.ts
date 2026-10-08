import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { AppUiTemplate } from "../../../todl-build-system/html-bundle/app-ui-template.js";
import { DiagnosticSink } from "../../../build-system-core/diagnostic-sink.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { GeneratorTrigger, type GeneratorContext, type IProjectModelProvider } from "../project-content-generator.js";
import { AppGenerator } from "../app-generator.js";

const OUTPUT_FILE = "src/app.mu";
const HAND_AUTHORED_CONTENT = "// mine";
const ModelName = "Widgets";
const ModelId = "acme_widgets";

class ThrowingModelProvider implements IProjectModelProvider
{
    public Compile(): Promise<never>
    {
        throw new Error("AppGenerator must not compile the model");
    }

    public CompileLocal(): Promise<never>
    {
        throw new Error("AppGenerator must not compile the model");
    }
}

class Fixture
{
    public static Manifest(id?: string): ProjectManifest
    {
        return { type: ProjectType.Architecture, name: ModelName, version: 1, ...(id === undefined ? {} : { id }) };
    }

    public static Context(project: FakeStorage, manifest: ProjectManifest): GeneratorContext
    {
        return { Project: project, Manifest: manifest, Model: new ThrowingModelProvider(), Diagnostics: new DiagnosticSink(), Reason: GeneratorTrigger.ProjectCreated };
    }
}

describe("AppGenerator.Generate", () =>
{
    test("writes the src/app.mu scaffold once, from the manifest name", async () =>
    {
        const project = new FakeStorage();
        const result = await new AppGenerator().Generate(Fixture.Context(project, Fixture.Manifest()));

        assert.equal(await project.ReadText(OUTPUT_FILE), AppUiTemplate.Render(ModelName));
        assert.ok(result.Written.includes(OUTPUT_FILE));
        assert.equal(result.Skipped.length, 0);
    });

    test("identity prefers manifest id over name", async () =>
    {
        const project = new FakeStorage();
        await new AppGenerator().Generate(Fixture.Context(project, Fixture.Manifest(ModelId)));

        assert.equal(await project.ReadText(OUTPUT_FILE), AppUiTemplate.Render(ModelId));
    });

    test("WriteOnce no-clobber: does not overwrite an existing file", async () =>
    {
        const project = new FakeStorage();
        await project.WriteText(OUTPUT_FILE, HAND_AUTHORED_CONTENT);

        const result = await new AppGenerator().Generate(Fixture.Context(project, Fixture.Manifest()));

        assert.equal(await project.ReadText(OUTPUT_FILE), HAND_AUTHORED_CONTENT);
        assert.ok(result.Skipped.includes(OUTPUT_FILE));
        assert.equal(result.Written.length, 0);
    });
});
