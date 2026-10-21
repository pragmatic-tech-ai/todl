import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { DiagnosticSink } from "../../../build-system-core/diagnostic-sink.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { GeneratorTrigger, WritePolicy, type GeneratorContext, type IProjectModelProvider } from "../project-content-generator.js";
import { AppViewModelGenerator } from "../app-view-model-generator.js";

const OUTPUT_FILE = "src/main.ts";

class UnusedModelProvider implements IProjectModelProvider
{
    public Compile(): Promise<never>
    {
        throw new Error("app-view-model must not compile the model");
    }

    public CompileLocal(): Promise<never>
    {
        throw new Error("app-view-model must not compile the model");
    }
}

class Harness
{
    public static ContextFor(manifest: ProjectManifest, project: FakeStorage): GeneratorContext
    {
        return { Project: project, Manifest: manifest, Model: new UnusedModelProvider(), Diagnostics: new DiagnosticSink(), Reason: GeneratorTrigger.ProjectCreated };
    }
}

test("scaffolds src/main.ts with the <Project>App view-model", async () =>
{
    const project = new FakeStorage();
    const manifest: ProjectManifest = { type: ProjectType.Architecture, name: "test_waf_architectures", version: 1 };
    const generator = new AppViewModelGenerator();
    const result = await generator.Generate(Harness.ContextFor(manifest, project));
    assert.deepEqual(result.Written, [OUTPUT_FILE]);
    assert.equal(generator.WritePolicy, WritePolicy.WriteOnce);
    const out = await project.ReadText(OUTPUT_FILE);
    assert.match(out, /import \{ Application \} from "@pragmatic-tech-ai\/mural";/);
    assert.match(out, /export class TestWafArchitecturesApp extends Observable/);
    assert.match(out, /import \{ Observable \} from "@pragmatic-tech-ai\/mural\/runtime";/);
    assert.match(out, /import \{ model \} from "\.\.\/generated\/data\.js";/);
    assert.match(out, /Application\.current\?\.Services\.addInstance\(this\);/);
    assert.match(out, /Hello from test_waf_architectures/);
    assert.match(out, /model\.ConceptNames\(\)\.length/);
    assert.doesNotMatch(out, /new TestWafArchitecturesApp\(\)/);
    assert.match(out, /public get HelloText\(\): string/);
    assert.match(out, /public get ConceptSummary\(\): string/);
    assert.match(out, /\n\{\n    constructor\(\)\n    \{\n        super\(\);/);
});

test("names the class from manifest id but greets with the raw name", async () =>
{
    const project = new FakeStorage();
    const manifest: ProjectManifest = { type: ProjectType.Architecture, name: "my_proj", id: "real_id", version: 1 };
    await new AppViewModelGenerator().Generate(Harness.ContextFor(manifest, project));
    const out = await project.ReadText(OUTPUT_FILE);
    assert.match(out, /export class RealIdApp extends Observable/);
    assert.match(out, /Hello from my_proj/);
});

test("never overwrites a user-edited src/main.ts", async () =>
{
    const project = new FakeStorage();
    await project.WriteText(OUTPUT_FILE, "user edits");
    const manifest: ProjectManifest = { type: ProjectType.Architecture, name: "a_b", version: 1 };
    const result = await new AppViewModelGenerator().Generate(Harness.ContextFor(manifest, project));
    assert.deepEqual(result.Skipped, [OUTPUT_FILE]);
    assert.equal(await project.ReadText(OUTPUT_FILE), "user edits");
});
