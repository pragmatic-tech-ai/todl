import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { DiagnosticSink } from "../../../build-system-core/diagnostic-sink.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { GeneratorTrigger, type GeneratorContext, type IProjectModelProvider } from "../project-content-generator.js";
import { ModelInstanceGenerator } from "../model-instance-generator.js";

const OUTPUT_FILE = "generated/data.ts";

class UnusedModelProvider implements IProjectModelProvider
{
    public Compile(): Promise<never>
    {
        throw new Error("model-data must not compile the model");
    }

    public CompileLocal(): Promise<never>
    {
        throw new Error("model-data must not compile the model");
    }
}

function contextFor(manifest: ProjectManifest, project: FakeStorage): GeneratorContext
{
    return { Project: project, Manifest: manifest, Model: new UnusedModelProvider(), Diagnostics: new DiagnosticSink(), Reason: GeneratorTrigger.ProjectCreated };
}

test("writes generated/data.ts exporting an initialized model", async () =>
{
    const project = new FakeStorage();
    const manifest: ProjectManifest = { type: ProjectType.Architecture, name: "test_waf_architectures", version: 1 };
    const result = await new ModelInstanceGenerator().Generate(contextFor(manifest, project));
    assert.deepEqual(result.Written, [OUTPUT_FILE]);
    const out = await project.ReadText(OUTPUT_FILE);
    assert.match(out, /import \{ TestWafArchitectures \} from "\.\/model\.js";/);
    assert.match(out, /export const model = TestWafArchitectures\.fromJSON\(\(window as any\)\.__TODL_APP__\);/);
});

test("uses manifest id (as DtoGenerator does) when present", async () =>
{
    const project = new FakeStorage();
    const manifest: ProjectManifest = { type: ProjectType.Architecture, name: "Ignored", id: "real_id", version: 1 };
    await new ModelInstanceGenerator().Generate(contextFor(manifest, project));
    assert.match(await project.ReadText(OUTPUT_FILE), /import \{ RealId \} from/);
});

test("overwrites a stale data.ts", async () =>
{
    const project = new FakeStorage();
    await project.WriteText(OUTPUT_FILE, "stale");
    const manifest: ProjectManifest = { type: ProjectType.Architecture, name: "a_b", version: 1 };
    await new ModelInstanceGenerator().Generate(contextFor(manifest, project));
    assert.match(await project.ReadText(OUTPUT_FILE), /AB\.fromJSON/);
});
