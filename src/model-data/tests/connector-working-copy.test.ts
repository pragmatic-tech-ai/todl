import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { FederatedModelDataConnector } from "../federated-model-data-connector.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import { DataSourceKind, WriteOperationKind, type ModelConnectorPlan, type WriteBatch, type WriteResult } from "../connector-plan.js";
import type { IDataSourceAdapter } from "../data-source-adapter.js";
import type { ResolvedConnection } from "../connector-plan.js";
import { CountingAdapterFactory } from "./fakes.js";

class RecordingFactory extends CountingAdapterFactory
{
    public readonly Batches: WriteBatch[] = [];
    public ConflictKey: string | undefined;

    public override async Open(connection: ResolvedConnection): Promise<IDataSourceAdapter>
    {
        const inner = await super.Open(connection);
        return {
            Query: request => inner.Query(request),
            Apply: async (batch: WriteBatch): Promise<WriteResult> =>
            {
                this.Batches.push(batch);
                if (this.ConflictKey !== undefined)
                {
                    return { Applied: 0, Conflicts: [{ Key: this.ConflictKey, Reason: "conflict" }] };
                }
                return inner.Apply(batch);
            },
        };
    }
}

class WorkingCopyFixture
{
    public readonly Factory = new RecordingFactory(DataSourceKind.Sql);
    public readonly Catalog = new DataSourceAdapterCatalog().Register(this.Factory);
    public readonly Services = new ServiceProvider();

    public constructor(public readonly Writable: boolean)
    {
        this.Factory.Seed("order", [{ order_id: "O-1", display_name: "Acme" }]);
        this.Services.registerInstance(DataSourceAdapterCatalog.ServiceKey, this.Catalog);
    }

    public Connector(): FederatedModelDataConnector
    {
        const plan: ModelConnectorPlan =
        {
            Model: "Sales", Version: "0.0.0",
            Connectors: [{ Name: "pg", Kind: DataSourceKind.Sql, Config: {} }],
            Bindings: [{ Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "order_id", FieldMap: { id: "order_id", label: "display_name" }, Writable: this.Writable }],
        };
        return new FederatedModelDataConnector(plan, { nodes: [], edges: [] });
    }
}

test("WorkingCopy before Prepare throws", () =>
{
    assert.throws(() => new WorkingCopyFixture(true).Connector().WorkingCopy(), /Prepare/);
});

test("Flush upserts dirty instance with external fields and clears the mark", async () =>
{
    const fx = new WorkingCopyFixture(true);
    const connector = fx.Connector();
    const doc = await connector.Prepare(fx.Services);
    const node = doc.nodes.find(n => n.storageId === "O-1")!;
    node.attrs["label"] = "Acme Corp";
    const wc = connector.WorkingCopy();
    assert.equal(connector.WorkingCopy(), wc);
    wc.MarkDirty(node.id);
    const results = await wc.Flush(fx.Catalog, fx.Services);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.Applied, 1);
    assert.equal(fx.Factory.Batches.length, 1);
    const op = fx.Factory.Batches[0]!.Operations[0]!;
    assert.equal(op.Kind, WriteOperationKind.Upsert);
    assert.equal(op.Key, "O-1");
    assert.deepEqual(op.Fields, { display_name: "Acme Corp" });
    await wc.Flush(fx.Catalog, fx.Services);
    assert.equal(fx.Factory.Batches.length, 1, "second flush sends nothing");
});

test("MarkDeleted sends a Delete operation", async () =>
{
    const fx = new WorkingCopyFixture(true);
    const connector = fx.Connector();
    const doc = await connector.Prepare(fx.Services);
    const wc = connector.WorkingCopy();
    wc.MarkDeleted(doc.nodes.find(n => n.storageId === "O-1")!.id);
    await wc.Flush(fx.Catalog, fx.Services);
    assert.equal(fx.Factory.Batches[0]!.Operations[0]!.Kind, WriteOperationKind.Delete);
    assert.equal(fx.Factory.Batches[0]!.Operations[0]!.Key, "O-1");
});

test("read-only binding: MarkDirty + Flush sends no batch", async () =>
{
    const fx = new WorkingCopyFixture(false);
    const connector = fx.Connector();
    const doc = await connector.Prepare(fx.Services);
    const wc = connector.WorkingCopy();
    wc.MarkDirty(doc.nodes.find(n => n.storageId === "O-1")!.id);
    const results = await wc.Flush(fx.Catalog, fx.Services);
    assert.equal(results.length, 0);
    assert.equal(fx.Factory.Batches.length, 0);
});

test("conflicted operation stays pending for retry", async () =>
{
    const fx = new WorkingCopyFixture(true);
    const connector = fx.Connector();
    const doc = await connector.Prepare(fx.Services);
    const wc = connector.WorkingCopy();
    wc.MarkDirty(doc.nodes.find(n => n.storageId === "O-1")!.id);
    fx.Factory.ConflictKey = "O-1";
    await wc.Flush(fx.Catalog, fx.Services);
    fx.Factory.ConflictKey = undefined;
    const retry = await wc.Flush(fx.Catalog, fx.Services);
    assert.equal(retry.length, 1);
    assert.equal(retry[0]!.Applied, 1);
});
