import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { FederatedModelDataConnector } from "../federated-model-data-connector.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import { DataSourceKind, WriteOperationKind, type ModelConnectorPlan, type WriteBatch, type WriteResult, type ExternalRecord, type QueryRequest } from "../connector-plan.js";
import type { IDataSourceAdapter } from "../data-source-adapter.js";
import type { ResolvedConnection } from "../connector-plan.js";
import { ConnectorWorkingCopy } from "../connector-working-copy.js";
import { DiagnosticCode } from "../../compiler-services/diagnostics/diagnostic.js";
import type { JsonNode, TodlDocument } from "../../compiler-services/emit/json.js";
import { CountingAdapterFactory, InMemoryAdapterFactory } from "./fakes.js";

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

    public constructor(public readonly Writable: boolean, public readonly Versioned: boolean = false)
    {
        this.Factory.Seed("order", [this.Versioned ? { order_id: "O-1", display_name: "Acme", ver: 2 } : { order_id: "O-1", display_name: "Acme" }]);
        this.Services.registerInstance(DataSourceAdapterCatalog.ServiceKey, this.Catalog);
    }

    public async Rows(source: string): Promise<readonly ExternalRecord[]>
    {
        const adapter = await this.Factory.Open({ Kind: DataSourceKind.Sql, Config: {} } as ResolvedConnection);
        return adapter.Query({ Source: source, Fields: ["order_id", "display_name", "ver"] } as QueryRequest);
    }

    public Plan(): ModelConnectorPlan
    {
        return {
            Model: "Sales", Version: "0.0.0",
            Connectors: [{ Name: "pg", Kind: DataSourceKind.Sql, Config: {} }],
            Bindings: [{ Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "order_id", FieldMap: this.Versioned ? { id: "order_id", label: "display_name", version: "ver" } : { id: "order_id", label: "display_name" }, Writable: this.Writable, ...(this.Versioned ? { VersionField: "ver" } : {}) }],
        };
    }

    public Connector(): FederatedModelDataConnector
    {
        return new FederatedModelDataConnector(this.Plan(), { nodes: [], edges: [] });
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
    const { Results: results } = await wc.Flush(fx.Catalog, fx.Services);
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
    const diagnostic = wc.MarkDirty(doc.nodes.find(n => n.storageId === "O-1")!.id);
    assert.equal(diagnostic?.code, DiagnosticCode.ConnectorReadOnly);
    assert.match(diagnostic!.message, /a\.Order/);
    const { Results: results } = await wc.Flush(fx.Catalog, fx.Services);
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
    const { Results: first } = await wc.Flush(fx.Catalog, fx.Services);
    assert.equal(first.length, 1);
    assert.equal(first[0]!.Conflicts[0]!.Key, "O-1");
    fx.Factory.ConflictKey = undefined;
    const { Results: retry } = await wc.Flush(fx.Catalog, fx.Services);
    assert.equal(retry.length, 1);
    assert.equal(retry[0]!.Applied, 1);
});

test("MarkDirty of an instance whose concept has no binding is a no-op", async () =>
{
    const fx = new WorkingCopyFixture(true);
    const connector = fx.Connector();
    const doc = await connector.Prepare(fx.Services);
    const orphan: JsonNode =
    {
        id: "a.Customer#c1", tier: "Instance", type: "a.Customer", metaKind: null, namespace: "a", localId: "Customer#c1",
        isClass: false, class: null, storageId: "C-1", canonicalId: null, fields: [], attrs: { label: "Hand" },
    };
    doc.nodes.push(orphan);
    const wc = new ConnectorWorkingCopy(fx.Plan(), doc, new Map([[orphan.id, [{ StorageId: "C-1", Connector: "pg", Source: "order" }]]]));
    wc.MarkDirty(orphan.id);
    const { Results: results } = await wc.Flush(fx.Catalog, fx.Services);
    assert.equal(results.length, 0);
    assert.equal(fx.Factory.Batches.length, 0);
});

test("dirty instance with no storageId produces no operation", async () =>
{
    const fx = new WorkingCopyFixture(true);
    const connector = fx.Connector();
    const doc = await connector.Prepare(fx.Services);
    const fresh: JsonNode =
    {
        id: "a.Order#new", tier: "Instance", type: "a.Order", metaKind: null, namespace: "a", localId: "Order#new",
        isClass: false, class: null, storageId: null, canonicalId: null, fields: [], attrs: { label: "New" },
    };
    doc.nodes.push(fresh);
    const wc = new ConnectorWorkingCopy(fx.Plan(), doc, new Map());
    wc.MarkDirty(fresh.id);
    const { Results: results } = await wc.Flush(fx.Catalog, fx.Services);
    assert.equal(results.length, 0);
    assert.equal(fx.Factory.Batches.length, 0);
});

test("writable MarkDirty returns no diagnostic", async () =>
{
    const fx = new WorkingCopyFixture(true);
    const connector = fx.Connector();
    const doc = await connector.Prepare(fx.Services);
    assert.equal(connector.WorkingCopy().MarkDirty(doc.nodes.find(n => n.storageId === "O-1")!.id), undefined);
});

test("VersionField: stale version yields write-conflict diagnostic, row unchanged, stays pending", async () =>
{
    const fx = new WorkingCopyFixture(true, true);
    const connector = fx.Connector();
    const doc = await connector.Prepare(fx.Services);
    const node = doc.nodes.find(n => n.storageId === "O-1")!;
    node.attrs["label"] = "Changed";
    node.attrs["version"] = 1;
    const wc = connector.WorkingCopy();
    wc.MarkDirty(node.id);
    const first = await wc.Flush(fx.Catalog, fx.Services);
    assert.equal(fx.Factory.Batches[0]!.VersionField, "ver");
    assert.equal(fx.Factory.Batches[0]!.Operations[0]!.Version, 1);
    assert.equal(first.Diagnostics.length, 1);
    assert.equal(first.Diagnostics[0]!.code, DiagnosticCode.ConnectorWriteConflict);
    assert.match(first.Diagnostics[0]!.message, /O-1/);
    const stored = await fx.Rows("order");
    assert.equal(stored[0]!["display_name"], "Acme");
    node.attrs["version"] = 2;
    const retry = await wc.Flush(fx.Catalog, fx.Services);
    assert.equal(retry.Diagnostics.length, 0);
    assert.equal(retry.Results[0]!.Applied, 1);
});

test("no VersionField: same edit upserts last-write-wins without conflict", async () =>
{
    const fx = new WorkingCopyFixture(true);
    const connector = fx.Connector();
    const doc = await connector.Prepare(fx.Services);
    const node = doc.nodes.find(n => n.storageId === "O-1")!;
    node.attrs["label"] = "Changed";
    const wc = connector.WorkingCopy();
    wc.MarkDirty(node.id);
    const outcome = await wc.Flush(fx.Catalog, fx.Services);
    assert.equal(outcome.Diagnostics.length, 0);
    assert.equal(outcome.Results[0]!.Applied, 1);
    assert.equal(fx.Factory.Batches[0]!.VersionField, undefined);
});

test("Flush fans a merged canonical out to every writable source and reports read-only ones", async () =>
{
    const field = { customer_id: "customer_id", email: "email" };
    const plan: ModelConnectorPlan =
    {
        Model: "shop", Version: "1",
        Connectors: [{ Name: "opsdb", Kind: DataSourceKind.Sql, Config: {} }],
        Bindings: [
            { Concept: "shop.Customer", Connector: "opsdb", Source: "contacts", IdKey: "customer_id", FieldMap: field, Writable: true },
            { Concept: "shop.Customer", Connector: "opsdb", Source: "legacy", IdKey: "customer_id", FieldMap: field, Writable: false },
        ],
    };
    const canonicalId = "shop.Customer#opsdb.contacts#C1";
    const node: JsonNode =
    {
        id: canonicalId, tier: "Instance", type: "shop.Customer", metaKind: null, namespace: "shop", localId: "Customer#opsdb.contacts#C1",
        isClass: false, class: null, storageId: "C1", canonicalId: null, fields: [], attrs: { email: "merged@acme.com" },
    };
    const writeTargets = new Map([[canonicalId, [
        { StorageId: "C1", Connector: "opsdb", Source: "contacts" },
        { StorageId: "C1", Connector: "opsdb", Source: "legacy" },
    ]]]);
    const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const services = new ServiceProvider();

    const document: TodlDocument = { nodes: [node], edges: [] };
    const copy = new ConnectorWorkingCopy(plan, document, writeTargets);
    assert.equal(copy.MarkDirty(canonicalId), undefined);
    const outcome = await copy.Flush(catalog, services);

    assert.equal(outcome.Results.reduce((n, r) => n + r.Applied, 0), 1);
    assert.ok(outcome.Diagnostics.some(d => d.code === DiagnosticCode.ConnectorReadOnly));

    const query = { Fields: ["customer_id", "email"] };
    const contacts = await factory.Adapter.Query({ ...query, Source: "contacts" } as QueryRequest);
    const legacy = await factory.Adapter.Query({ ...query, Source: "legacy" } as QueryRequest);
    assert.deepEqual(contacts, [{ customer_id: "C1", email: "merged@acme.com" }]);
    assert.deepEqual(legacy, []);
});
