import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { FederatedModelDataConnector } from "../federated-model-data-connector.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import { DataSourceKind, WriteAtomicity, WriteConcurrency, WriteFailureKind, WriteOperationKind, type ModelConnectorPlan, type WriteBatch, type WriteFailure, type WriteResult, type ExternalRecord, type QueryRequest } from "../connector-plan.js";
import type { IDataSourceAdapter, IDataSourceAdapterFactory } from "../data-source-adapter.js";
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
                    return { Applied: 0, Failures: [{ Key: this.ConflictKey, Kind: WriteFailureKind.Conflict, Reason: "conflict" }] };
                }
                return inner.Apply(batch);
            },
            Dispose: () => inner.Dispose(),
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
            Bindings: [{ Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "order_id", FieldMap: this.Versioned ? { id: "order_id", label: "display_name", version: "ver" } : { id: "order_id", label: "display_name" }, Writable: this.Writable, ...(this.Versioned ? { VersionField: "ver", Concurrency: WriteConcurrency.Optimistic } : {}) }],
        };
    }

    public Connector(): FederatedModelDataConnector
    {
        return new FederatedModelDataConnector(this.Plan(), { nodes: [], edges: [] });
    }
}

/** A write adapter scriptable per source and per key: throw on named sources, fail chosen keys
 *  with a chosen WriteFailureKind, and (for rollback sources) return Applied 0 + only the first
 *  faulting op — the shape a rolled-back transactional batch reports. */
class ProgrammableAdapter implements IDataSourceAdapter
{
    public readonly Batches: WriteBatch[] = [];
    public readonly ThrowSources = new Set<string>();
    public readonly RollbackSources = new Set<string>();
    public readonly FailKeys = new Map<string, WriteFailureKind>();

    public async Query(): Promise<readonly ExternalRecord[]>
    {
        return [];
    }

    public async Apply(batch: WriteBatch): Promise<WriteResult>
    {
        this.Batches.push(batch);
        if (this.ThrowSources.has(batch.Source)) throw new Error(`apply exploded for ${batch.Source}`);
        const failures: WriteFailure[] = [];
        let applied = 0;
        for (const op of batch.Operations)
        {
            const kind = this.FailKeys.get(String(op.Key));
            if (kind !== undefined) failures.push({ Key: op.Key, Kind: kind, Reason: `${kind} on ${String(op.Key)}` });
            else applied++;
        }
        if (this.RollbackSources.has(batch.Source) && failures.length > 0)
        {
            return { Applied: 0, Failures: [failures[0]!] };
        }
        return { Applied: applied, Failures: failures };
    }

    public async Dispose(): Promise<void>
    {
    }
}

class ProgrammableFactory implements IDataSourceAdapterFactory
{
    public readonly Adapter = new ProgrammableAdapter();

    public constructor(public readonly Kind: DataSourceKind)
    {
    }

    public async Open(): Promise<IDataSourceAdapter>
    {
        return this.Adapter;
    }
}

/** A factory whose Open always rejects — the connection cannot be established. */
class ThrowingOpenFactory implements IDataSourceAdapterFactory
{
    private static readonly OpenFailure = "cannot open connection";

    public constructor(public readonly Kind: DataSourceKind)
    {
    }

    public async Open(): Promise<IDataSourceAdapter>
    {
        throw new Error(ThrowingOpenFactory.OpenFailure);
    }
}

class Nodes
{
    public static Order(id: string, storageId: string, type: string = "a.Order"): JsonNode
    {
        return {
            id, tier: "Instance", type, metaKind: null, namespace: "a", localId: id,
            isClass: false, class: null, storageId, canonicalId: null, fields: [], attrs: { label: storageId },
        };
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
    assert.equal(first[0]!.Failures[0]!.Key, "O-1");
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
    assert.equal(fx.Factory.Batches[0]!.Concurrency, WriteConcurrency.LastWriteWins, "absent axis defaults to last-write-wins");
    assert.equal(fx.Factory.Batches[0]!.Atomicity, WriteAtomicity.Sequential, "absent axis defaults to sequential");
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

class ProgrammableScenario
{
    public readonly Factory = new ProgrammableFactory(DataSourceKind.Sql);
    public readonly Catalog = new DataSourceAdapterCatalog().Register(this.Factory);
    public readonly Services = new ServiceProvider();

    public get Adapter(): ProgrammableAdapter
    {
        return this.Factory.Adapter;
    }

    public Build(bindings: ModelConnectorPlan["Bindings"], nodes: readonly JsonNode[], targets: ReadonlyMap<string, { StorageId: string; Connector: string; Source: string }[]>): ConnectorWorkingCopy
    {
        const plan: ModelConnectorPlan = { Model: "Sales", Version: "0.0.0", Connectors: [{ Name: "pg", Kind: DataSourceKind.Sql, Config: {} }], Bindings: bindings };
        return new ConnectorWorkingCopy(plan, { nodes: [...nodes], edges: [] }, targets);
    }
}

test("the WriteBatch carries the binding's Concurrency/Atomicity/VersionField", async () =>
{
    const scenario = new ProgrammableScenario();
    const node = Nodes.Order("a.Order#o1", "O-1");
    node.attrs["version"] = 2;
    const copy = scenario.Build(
        [{ Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "order_id", FieldMap: { id: "order_id", label: "display_name", version: "ver" }, Writable: true, VersionField: "ver", Concurrency: WriteConcurrency.Optimistic, Atomicity: WriteAtomicity.Transactional }],
        [node],
        new Map([[node.id, [{ StorageId: "O-1", Connector: "pg", Source: "order" }]]]));
    copy.MarkDirty(node.id);
    await copy.Flush(scenario.Catalog, scenario.Services);
    const batch = scenario.Adapter.Batches[0]!;
    assert.equal(batch.Concurrency, WriteConcurrency.Optimistic);
    assert.equal(batch.Atomicity, WriteAtomicity.Transactional);
    assert.equal(batch.VersionField, "ver");
});

test("applied ops are cleared, failed ops stay pending, one diagnostic per failure", async () =>
{
    const scenario = new ProgrammableScenario();
    const n1 = Nodes.Order("a.Order#o1", "O-1");
    const n2 = Nodes.Order("a.Order#o2", "O-2");
    const copy = scenario.Build(
        [{ Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "order_id", FieldMap: { id: "order_id", label: "display_name" }, Writable: true, Atomicity: WriteAtomicity.Sequential }],
        [n1, n2],
        new Map([
            [n1.id, [{ StorageId: "O-1", Connector: "pg", Source: "order" }]],
            [n2.id, [{ StorageId: "O-2", Connector: "pg", Source: "order" }]],
        ]));
    scenario.Adapter.FailKeys.set("O-2", WriteFailureKind.Conflict);
    copy.MarkDirty(n1.id);
    copy.MarkDirty(n2.id);

    const outcome = await copy.Flush(scenario.Catalog, scenario.Services);
    assert.equal(outcome.Results[0]!.Applied, 1);
    assert.equal(outcome.Diagnostics.length, 1, "one diagnostic for the single failure, not per operation");
    assert.equal(outcome.Diagnostics[0]!.code, DiagnosticCode.ConnectorWriteConflict);

    // Second flush re-sends ONLY the previously failed O-2 (O-1 was cleared).
    scenario.Adapter.FailKeys.clear();
    const retry = await copy.Flush(scenario.Catalog, scenario.Services);
    const retried = scenario.Adapter.Batches[scenario.Adapter.Batches.length - 1]!;
    assert.equal(retried.Operations.length, 1);
    assert.equal(retried.Operations[0]!.Key, "O-2");
    assert.equal(retry.Results[0]!.Applied, 1);
});

test("a rolled-back Transactional binding keeps ALL its ops pending", async () =>
{
    const scenario = new ProgrammableScenario();
    const n1 = Nodes.Order("a.Order#o1", "O-1");
    const n2 = Nodes.Order("a.Order#o2", "O-2");
    const n3 = Nodes.Order("a.Order#o3", "O-3");
    const copy = scenario.Build(
        [{ Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "order_id", FieldMap: { id: "order_id", label: "display_name" }, Writable: true, Atomicity: WriteAtomicity.Transactional }],
        [n1, n2, n3],
        new Map([
            [n1.id, [{ StorageId: "O-1", Connector: "pg", Source: "order" }]],
            [n2.id, [{ StorageId: "O-2", Connector: "pg", Source: "order" }]],
            [n3.id, [{ StorageId: "O-3", Connector: "pg", Source: "order" }]],
        ]));
    scenario.Adapter.RollbackSources.add("order");
    scenario.Adapter.FailKeys.set("O-2", WriteFailureKind.Error);
    copy.MarkDirty(n1.id);
    copy.MarkDirty(n2.id);
    copy.MarkDirty(n3.id);

    const first = await copy.Flush(scenario.Catalog, scenario.Services);
    assert.equal(first.Results[0]!.Applied, 0, "a rolled-back batch applied nothing");
    assert.equal(first.Results[0]!.Failures.length, 1, "backend reports only the faulting op");
    assert.equal(first.Diagnostics.length, 1);
    assert.equal(first.Diagnostics[0]!.code, DiagnosticCode.ConnectorWriteFailed);

    // All three ops stay pending despite only one being in Failures: the whole batch rolled back.
    scenario.Adapter.RollbackSources.clear();
    scenario.Adapter.FailKeys.clear();
    const retry = await copy.Flush(scenario.Catalog, scenario.Services);
    const retried = scenario.Adapter.Batches[scenario.Adapter.Batches.length - 1]!;
    assert.equal(retried.Operations.length, 3);
    assert.equal(retry.Results[0]!.Applied, 3);
});

test("a throwing binding is isolated: its ops stay pending, other bindings still apply", async () =>
{
    const scenario = new ProgrammableScenario();
    const order = Nodes.Order("a.Order#o1", "O-1");
    const customer = Nodes.Order("a.Customer#c1", "C-1", "a.Customer");
    const copy = scenario.Build(
        [
            { Concept: "a.Order", Connector: "pg", Source: "throws", IdKey: "order_id", FieldMap: { id: "order_id", label: "display_name" }, Writable: true },
            { Concept: "a.Customer", Connector: "pg", Source: "ok", IdKey: "customer_id", FieldMap: { id: "customer_id", label: "display_name" }, Writable: true },
        ],
        [order, customer],
        new Map([
            [order.id, [{ StorageId: "O-1", Connector: "pg", Source: "throws" }]],
            [customer.id, [{ StorageId: "C-1", Connector: "pg", Source: "ok" }]],
        ]));
    scenario.Adapter.ThrowSources.add("throws");
    copy.MarkDirty(order.id);
    copy.MarkDirty(customer.id);

    const outcome = await copy.Flush(scenario.Catalog, scenario.Services);
    assert.ok(outcome.Diagnostics.some(d => d.code === DiagnosticCode.ConnectorWriteFailed), "the thrown error is reported as a write-failed diagnostic");
    assert.equal(scenario.Adapter.Batches.filter(b => b.Source === "ok").length, 1, "the healthy binding ran despite the other throwing");

    // The throwing binding stayed pending; the committed one cleared.
    scenario.Adapter.ThrowSources.clear();
    const retry = await copy.Flush(scenario.Catalog, scenario.Services);
    assert.equal(scenario.Adapter.Batches.filter(b => b.Source === "throws").length, 2, "throwing binding retried");
    assert.equal(scenario.Adapter.Batches.filter(b => b.Source === "ok").length, 1, "committed binding not retried");
    assert.equal(retry.Results.find(r => r.Applied > 0)!.Applied, 1);
});

test("a binding whose connection cannot open is isolated: its ops stay pending, other bindings still apply", async () =>
{
    const good = new ProgrammableFactory(DataSourceKind.Sql);
    const bad = new ThrowingOpenFactory(DataSourceKind.Rest);
    const catalog = new DataSourceAdapterCatalog().Register(good).Register(bad);
    const services = new ServiceProvider();
    const order = Nodes.Order("a.Order#o1", "O-1");
    const customer = Nodes.Order("a.Customer#c1", "C-1", "a.Customer");
    const plan: ModelConnectorPlan =
    {
        Model: "Sales", Version: "0.0.0",
        Connectors: [
            { Name: "pg", Kind: DataSourceKind.Sql, Config: {} },
            { Name: "api", Kind: DataSourceKind.Rest, Config: {} },
        ],
        Bindings: [
            { Concept: "a.Order", Connector: "api", Source: "orders", IdKey: "order_id", FieldMap: { id: "order_id", label: "display_name" }, Writable: true },
            { Concept: "a.Customer", Connector: "pg", Source: "contacts", IdKey: "customer_id", FieldMap: { id: "customer_id", label: "display_name" }, Writable: true },
        ],
    };
    const copy = new ConnectorWorkingCopy(plan, { nodes: [order, customer], edges: [] }, new Map([
        [order.id, [{ StorageId: "O-1", Connector: "api", Source: "orders" }]],
        [customer.id, [{ StorageId: "C-1", Connector: "pg", Source: "contacts" }]],
    ]));
    copy.MarkDirty(order.id);
    copy.MarkDirty(customer.id);

    const outcome = await copy.Flush(catalog, services);
    assert.ok(outcome.Diagnostics.some(d => d.code === DiagnosticCode.ConnectorWriteFailed), "the open failure is reported as a write-failed diagnostic");
    assert.equal(good.Adapter.Batches.filter(b => b.Source === "contacts").length, 1, "the healthy binding committed despite the sibling's open throwing");

    // The un-openable binding stayed pending; the committed one cleared and is not retried.
    const retry = await copy.Flush(catalog, services);
    assert.equal(good.Adapter.Batches.filter(b => b.Source === "contacts").length, 1, "committed binding not retried");
    assert.equal(retry.Results.reduce((n, r) => n + r.Applied, 0), 0, "only the still-un-openable binding remains, applying nothing");
});
