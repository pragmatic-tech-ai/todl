import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { compile, DEFAULT_SYMBOLS } from "@pragmatic-tech-ai/mural/compiler";
import { check } from "../../../../compiler-services/api.js";
import { toJSON } from "../../../../compiler-services/emit/json.js";
import { ProjectType } from "../../../package-manager/manifest.js";
import type { CompiledPackage } from "../../../../publish/publish.js";
import type { IProjectModelProvider, ProjectModel } from "../project-content-generator.js";
import type { ConceptGeneratorContext } from "../concept-ui-generator.js";
import { ConceptListViewGenerator } from "../concept-list-view-generator.js";
import { ConceptFormGenerator } from "../concept-form-generator.js";

const MODEL = "namespace acme { concept Empty { } concept Flag { on : boolean?; } concept Customer { name : string; nickname : string?; age : integer?; active : boolean?; } }";

class FakeModelProvider implements IProjectModelProvider
{
    public constructor(private readonly result: ProjectModel)
    {
    }

    public Compile(): Promise<ProjectModel>
    {
        return Promise.resolve(this.result);
    }

    public CompileLocal(): Promise<ProjectModel>
    {
        return Promise.resolve(this.result);
    }
}

class Fixture
{
    public static Context(project: FakeStorage, concept = "acme.Customer"): ConceptGeneratorContext
    {
        const doc = toJSON(check([{ uri: "m.todl", text: MODEL }]).model);
        const pkg = { fullDocument: doc } as unknown as CompiledPackage;
        return {
            Project: project,
            Manifest: { type: ProjectType.Architecture, name: "Customers", version: 1 },
            Model: new FakeModelProvider({ package: pkg, errors: [] }),
            Concept: concept,
        };
    }

    public static Compiles(source: string): void
    {
        compile(source, { symbols: new Map(DEFAULT_SYMBOLS) });
    }
}

describe("concept view generators", () =>
{
    test("list view emits bindings, compiles, and honours WriteOnce", async () =>
    {
        const project = new FakeStorage();
        const gen = new ConceptListViewGenerator();
        const result = await gen.Generate(Fixture.Context(project));
        const path = "src/ui/Customer/list.mu";
        assert.deepEqual(result.Written, [path]);
        const mu = await project.ReadText(path);
        assert.ok(mu.includes("ItemsSource = $Items"));
        assert.ok(mu.includes("SelectedItem = $Selected"));
        assert.ok(mu.includes("Command = $NewCommand"));
        assert.ok(mu.includes("Text = $name"));
        assert.ok(mu.includes("import CustomerVM from \"./Customer-vm.js\""));
        assert.ok(mu.includes("DataType = CustomerVM"));
        assert.doesNotThrow(() => Fixture.Compiles(mu));

        await project.WriteText(path, "hand edited");
        const again = await gen.Generate(Fixture.Context(project));
        assert.deepEqual(again.Skipped, [path]);
        assert.equal(await project.ReadText(path), "hand edited");
    });

    test("form emits a control per field and compiles", async () =>
    {
        const project = new FakeStorage();
        const result = await new ConceptFormGenerator().Generate(Fixture.Context(project));
        const path = "src/ui/Customer/form.mu";
        assert.deepEqual(result.Written, [path]);
        const mu = await project.ReadText(path);
        assert.ok(mu.includes("Command = $SaveCommand"));
        assert.ok(mu.includes("Text = $Selected.name"));
        assert.ok(mu.includes("IsChecked = $Selected.active"));
        assert.ok(mu.includes("Command = $DeleteCommand"));
        assert.ok(mu.includes("TextBox [ Text = $Selected.name ]"));
        assert.ok(mu.includes("TextBox [ Text = $Selected.nickname ]"));
        assert.ok(mu.includes("TextBox [ Text = $Selected.age ]"));
        assert.ok(mu.includes("Checkbox [ IsChecked = $Selected.active ]"));
        assert.doesNotThrow(() => Fixture.Compiles(mu));
    });

    test("empty-field and boolean-only concepts still emit compilable list and form", async () =>
    {
        for (const concept of ["acme.Empty", "acme.Flag"])
        {
            const project = new FakeStorage();
            const ctx = Fixture.Context(project, concept);
            const list = await new ConceptListViewGenerator().Generate(ctx);
            const form = await new ConceptFormGenerator().Generate(ctx);
            for (const path of [...list.Written, ...form.Written])
            {
                const mu = await project.ReadText(path);
                assert.doesNotThrow(() => Fixture.Compiles(mu), path);
            }
            assert.equal(list.Written.length + form.Written.length, 2);
        }
    });
});
