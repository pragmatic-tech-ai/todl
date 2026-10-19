import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { FakeStorage, Signal } from "@pragmatic-tech-ai/todl-runtime";
import { check } from "../../../../compiler-services/api.js";
import { toJSON } from "../../../../compiler-services/emit/json.js";
import { ProjectType } from "../../../package-manager/manifest.js";
import { ConnectorWriteOpKind, ConnectorWriteStatus } from "../../../../model-data/connector-write-op.js";
import type { ConnectorWriteOp, ConnectorWriteResult } from "../../../../model-data/connector-write-op.js";
import type { CompiledPackage } from "../../../../publish/publish.js";
import type { IProjectModelProvider, ProjectModel } from "../project-content-generator.js";
import type { ConceptGeneratorContext } from "../concept-ui-generator.js";
import { ConceptCrudViewModelGenerator } from "../concept-crud-view-model-generator.js";
import { ConceptListViewGenerator } from "../concept-list-view-generator.js";

/** A minimal ReflectedEntity stand-in: the emitted row VM only reads `id` + `Snapshot()`. */
class FakeEntity
{
    public constructor(public readonly id: string, private readonly snap: Record<string, unknown>)
    {
    }

    public Snapshot(): Record<string, unknown>
    {
        return this.snap;
    }
}

/** A minimal ModelDataSource stand-in: the emitted container VM calls `Instances` + `Apply`
 *  and subscribes to `DataChanged`. `emit()` simulates an async live load / external Refresh. */
class FakeModel
{
    public records: FakeEntity[] = [];
    public status: ConnectorWriteStatus = ConnectorWriteStatus.Applied;
    public assignId = "generated-id";
    public readonly DataChanged = new Signal<void>();

    public Instances(_concept: string): readonly FakeEntity[]
    {
        return this.records;
    }

    public async Apply(ops: readonly ConnectorWriteOp[]): Promise<ConnectorWriteResult>
    {
        const op = ops[0]!;
        if (this.status !== ConnectorWriteStatus.Applied)
        {
            return { Results: [{ Status: this.status, Reason: "rejected" }] };
        }
        if (op.Kind === ConnectorWriteOpKind.Create)
        {
            this.records = [...this.records, new FakeEntity(this.assignId, { ...(op.Fields ?? {}) })];
            return { Results: [{ Status: ConnectorWriteStatus.Applied, Id: this.assignId }] };
        }
        if (op.Kind === ConnectorWriteOpKind.Delete)
        {
            this.records = this.records.filter((r) => r.id !== op.Id);
            return { Results: [{ Status: ConnectorWriteStatus.Applied, Id: op.Id! }] };
        }
        return { Results: [{ Status: ConnectorWriteStatus.Applied, Id: op.Id! }] };
    }
}

/** An emitted, dynamically-imported VM module plus the behavioural drivers the tests need. */
class VmHarness
{
    private constructor(public readonly RowVm: new () => any, public readonly ListVm: new (model: unknown) => any, private readonly tempPath: string)
    {
    }

    /** Emit `<Class>-vm.ts`, write it next to this test (so its bare imports resolve), and import it. */
    public static async Load(ts: string): Promise<VmHarness>
    {
        const here = dirname(fileURLToPath(import.meta.url));
        const tempPath = join(here, `.tmp-customer-vm.${Date.now()}.${Math.random().toString(36).slice(2)}.ts`);
        await writeFile(tempPath, ts, "utf8");
        const mod = await import(pathToFileURL(tempPath).href);
        return new VmHarness(mod.default, mod.CustomerListVM, tempPath);
    }

    /** Let the awaited Apply continuation (RebuildItems + Selected reconcile) settle. */
    public static async Flush(): Promise<void>
    {
        for (let i = 0; i < 8; i++)
        {
            await Promise.resolve();
        }
    }

    public async Dispose(): Promise<void>
    {
        await rm(this.tempPath, { force: true });
    }
}

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

    test("Selected is reconciled to the rebuilt row after a successful Save", async () =>
    {
        const project = new FakeStorage();
        await new ConceptCrudViewModelGenerator().Generate(Fixture.Context(project));
        const ts = await project.ReadText("src/ui/Customer/Customer-vm.ts");
        const harness = await VmHarness.Load(ts);
        try
        {
            const model = new FakeModel();
            model.records = [new FakeEntity("c1", { name: "A" })];
            model.assignId = "c2";
            const list = new harness.ListVm(model);

            list.NewCommand.Execute();          // Selected := blank, IsNew = true, Id = undefined
            assert.equal(list.Selected.IsNew, true);
            list.Selected.name = "B";

            list.SaveCommand.Execute();
            await VmHarness.Flush();

            // Selected now points at a rebuilt row (fresh, IsNew = false) whose Id matches the saved record.
            assert.equal(list.Selected?.Id, "c2");
            assert.equal(list.Selected?.IsNew, false);
            assert.ok(list.Items.includes(list.Selected));
        }
        finally
        {
            await harness.Dispose();
        }
    });

    test("async load: a DataChanged emit populates Items, and an IsNew Selected survives the rebuild", async () =>
    {
        const project = new FakeStorage();
        await new ConceptCrudViewModelGenerator().Generate(Fixture.Context(project));
        const ts = await project.ReadText("src/ui/Customer/Customer-vm.ts");
        const harness = await VmHarness.Load(ts);
        try
        {
            // Remote model: no data at construction (live fetch has not landed yet).
            const model = new FakeModel();
            const list = new harness.ListVm(model);
            assert.equal(list.Items.length, 0);

            // The live data lands and the model emits DataChanged → the list re-reads.
            model.records = [new FakeEntity("c1", { name: "A" }), new FakeEntity("c2", { name: "B" })];
            model.DataChanged.emit();
            await VmHarness.Flush();
            assert.equal(list.Items.length, 2);

            // A non-new Selected re-points to the rebuilt row with the same Id.
            list.Selected = list.Items.find((row: { Id?: string }) => row.Id === "c1");
            model.DataChanged.emit();
            await VmHarness.Flush();
            assert.equal(list.Selected?.Id, "c1");
            assert.ok(list.Items.includes(list.Selected));

            // An unsaved new row in progress is NOT wiped by an external rebuild.
            list.NewCommand.Execute();
            list.Selected.name = "draft";
            assert.equal(list.Selected.IsNew, true);
            model.DataChanged.emit();
            await VmHarness.Flush();
            assert.equal(list.Selected?.IsNew, true);
            assert.equal(list.Selected?.name, "draft");
        }
        finally
        {
            await harness.Dispose();
        }
    });

    test("Selected is cleared after a successful Delete", async () =>
    {
        const project = new FakeStorage();
        await new ConceptCrudViewModelGenerator().Generate(Fixture.Context(project));
        const ts = await project.ReadText("src/ui/Customer/Customer-vm.ts");
        const harness = await VmHarness.Load(ts);
        try
        {
            const model = new FakeModel();
            model.records = [new FakeEntity("c1", { name: "A" }), new FakeEntity("c2", { name: "B" })];
            const list = new harness.ListVm(model);

            list.Selected = list.Items.find((row: { Id?: string }) => row.Id === "c1");
            assert.equal(list.Selected?.Id, "c1");

            list.DeleteCommand.Execute();
            await VmHarness.Flush();

            assert.equal(list.Selected, undefined);
            assert.equal(list.Items.length, 1);
            assert.equal(list.Items[0].Id, "c2");
        }
        finally
        {
            await harness.Dispose();
        }
    });
});
