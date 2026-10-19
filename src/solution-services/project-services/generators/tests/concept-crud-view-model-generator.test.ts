import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { check } from "../../../../compiler-services/api.js";
import { toJSON } from "../../../../compiler-services/emit/json.js";
import { ProjectType } from "../../../package-manager/manifest.js";
import type { CompiledPackage } from "../../../../publish/publish.js";
import type { IProjectModelProvider, ProjectModel } from "../project-content-generator.js";
import type { ConceptGeneratorContext } from "../concept-ui-generator.js";
import { ConceptCrudViewModelGenerator } from "../concept-crud-view-model-generator.js";
import { ConceptListViewGenerator } from "../concept-list-view-generator.js";

const MODEL = "namespace acme { concept Customer { name : string; nickname : string?; age : integer?; active : boolean?; } }";

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
}

describe("concept CRUD view-model generator", () =>
{
    test("emits row + container VMs, write ops, and honours WriteOnce", async () =>
    {
        const project = new FakeStorage();
        const gen = new ConceptCrudViewModelGenerator();
        const result = await gen.Generate(Fixture.Context(project));
        const path = "src/ui/Customer/Customer-vm.ts";
        assert.deepEqual(result.Written, [path]);

        const ts = await project.ReadText(path);

        // Row + container classes.
        assert.ok(ts.includes("export default class CustomerVM extends Observable"));
        assert.ok(ts.includes("export class CustomerListVM extends Observable"));

        // Observable + RelayCommand come from the real emitted-app import paths.
        assert.ok(ts.includes("import { Observable, RelayCommand } from \"@pragmatic-tech-ai/mural/runtime\""));

        // Commands are RelayCommands.
        assert.ok(ts.includes("this.NewCommand = new RelayCommand("));
        assert.ok(ts.includes("this.SaveCommand = new RelayCommand("));
        assert.ok(ts.includes("this.DeleteCommand = new RelayCommand("));

        // Write ops with each kind.
        assert.ok(ts.includes("ConnectorWriteOpKind.Create"));
        assert.ok(ts.includes("ConnectorWriteOpKind.Update"));
        assert.ok(ts.includes("ConnectorWriteOpKind.Delete"));
        assert.ok(ts.includes("public ToWriteOp(): ConnectorWriteOp"));

        // Goes through the write path.
        assert.ok(ts.includes("this.model.Apply("));

        // Number field coerces string -> number in the setter.
        assert.ok(ts.includes("this.values[\"age\"] = Number(value);"));

        // On a non-Applied result, ErrorText is set from Reason/Status.
        assert.ok(ts.includes("outcome.Status !== ConnectorWriteStatus.Applied"));
        assert.ok(ts.includes("this.ErrorText = outcome?.Reason ?? ConnectorWriteStatus["));

        // The Save path must NOT mutate Items before Apply resolves (re-read is the truth).
        const saveStart = ts.indexOf("private async Save(");
        assert.ok(saveStart >= 0);
        const applyAt = ts.indexOf(".Apply(", saveStart);
        assert.ok(applyAt >= 0);
        const beforeApply = ts.slice(saveStart, applyAt);
        assert.ok(!beforeApply.includes("this.items ="));
        assert.ok(!beforeApply.includes(".push("));

        // WriteOnce: a hand edit is preserved on re-run.
        await project.WriteText(path, "hand edited");
        const again = await gen.Generate(Fixture.Context(project));
        assert.deepEqual(again.Skipped, [path]);
        assert.equal(await project.ReadText(path), "hand edited");
    });

    test("list.mu import now targets the .js VM module", async () =>
    {
        const project = new FakeStorage();
        await new ConceptListViewGenerator().Generate(Fixture.Context(project));
        const mu = await project.ReadText("src/ui/Customer/list.mu");
        assert.ok(mu.includes("import CustomerVM from \"./Customer-vm.js\""));
        assert.ok(!mu.includes("./Customer-vm.mjs"));
    });
});
