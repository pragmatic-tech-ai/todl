import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { check } from "../../../../compiler-services/api.js";
import { fromJSON, toJSON } from "../../../../compiler-services/emit/json.js";
import { generateReadClient } from "../../../../codegen/read-client.js";
import { DiagnosticSink } from "../../../build-system-core/diagnostic-sink.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import type { CompiledPackage } from "../../../../publish/publish.js";
import { GeneratorTrigger, type GeneratorContext, type IProjectModelProvider, type ProjectModel } from "../project-content-generator.js";
import { DtoGenerator } from "../dto-generator.js";

const WIDGET_MODEL = "namespace acme { concept Widget { label : string?; } }";
const OUTPUT_FILE = "generated/model.ts";
const RUNTIME_IMPORT_SPECIFIER = "@pragmatic-tech-ai/todl";

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
    return { Project: project, Manifest: widgetManifest(), Model: model, Diagnostics: diagnostics, Reason: GeneratorTrigger.OnDemand };
}

describe("DtoGenerator.Generate", () =>
{
    test("produces the DTO and writes it via the write policy", async () =>
    {
        const doc = toJSON(check([{ uri: "m.todl", text: WIDGET_MODEL }]).model);
        const pkg = { fullDocument: doc } as unknown as CompiledPackage;
        const model = new FakeModelProvider({ package: pkg, errors: [] });
        const project = new FakeStorage();
        const diagnostics = new DiagnosticSink();
        const generator = new DtoGenerator();

        const result = await generator.Generate(contextFor(model, project, diagnostics));

        const expected = generateReadClient(fromJSON(doc), { name: "Widgets", importSpecifier: RUNTIME_IMPORT_SPECIFIER });
        assert.equal(await project.ReadText(OUTPUT_FILE), expected);
        assert.ok(result.Written.includes(OUTPUT_FILE));
        assert.equal(result.Skipped.length, 0);
    });

    test("no package → reports the errors and writes nothing", async () =>
    {
        const model = new FakeModelProvider({ errors: ["boom"] });
        const project = new FakeStorage();
        const diagnostics = new DiagnosticSink();
        const generator = new DtoGenerator();

        const result = await generator.Generate(contextFor(model, project, diagnostics));

        assert.equal(result.Written.length, 0);
        assert.equal(await project.Exists(OUTPUT_FILE), false);
        assert.ok(diagnostics.All().some((d) => d.message.includes("boom")));
    });
});
