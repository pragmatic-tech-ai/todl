import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider, type IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { FederatedModelDataConnector } from "../federated-model-data-connector.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import { check } from "../../compiler-services/api.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import { CountingAdapterFactory, InMemoryAdapterFactory } from "./fakes.js";
import type { JsonNode } from "../../compiler-services/emit/json.js";
import { ResolutionAuditSinkKey, type ResolutionAuditEvent } from "../resolution-audit-sink.js";
import { DiagnosticCode } from "../../compiler-services/diagnostics/diagnostic.js";
import type { IDataSourceAdapter } from "../data-source-adapter.js";
import { DataSourceKind, type ConnectorBinding, type ConnectorSpec, WriteConcurrency, WriteAtomicity, type ModelConnectorPlan } from "../connector-plan.js";

test("read path pulls one population and is idempotent", async () =>
{
    const factory = new CountingAdapterFactory(DataSourceKind.Sql);
    factory.Seed("order", [{ order_id: "O-1", display_name: "Acme" }]);
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const services = new ServiceProvider();
    services.registerInstance(DataSourceAdapterCatalog.ServiceKey, catalog);

    const plan: ModelConnectorPlan =
    {
        Model: "Sales", Version: "0.0.0",
        Connectors: [{ Name: "pg", Kind: DataSourceKind.Sql, Config: {} }],
        Bindings: [{ Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "order_id", FieldMap: { id: "order_id", label: "display_name" }, Writable: true, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential }],
    };
    const connector = new FederatedModelDataConnector(plan, { nodes: [], edges: [] });
    const first = await connector.Prepare(services);
    assert.ok(first.nodes.some((n) => n.storageId === "O-1" && n.attrs["label"] === "Acme"));
    const second = await connector.Prepare(services);
    assert.equal(second, first);
    assert.equal(factory.QueryCount, 1, "idempotent: no re-query on second Prepare");
});

class FederatedTestFixture
{
    public static Plan(connector: string): ModelConnectorPlan
    {
        return {
            Model: "Sales", Version: "0.0.0",
            Connectors: [{ Name: "pg", Kind: DataSourceKind.Sql, Config: {} }],
            Bindings: [{ Concept: "a.Order", Connector: connector, Source: "order", IdKey: "order_id", FieldMap: { id: "order_id", label: "display_name" }, Writable: true, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential }],
        };
    }

    public static Services(factory: CountingAdapterFactory): ServiceProvider
    {
        const services = new ServiceProvider();
        services.registerInstance(DataSourceAdapterCatalog.ServiceKey, new DataSourceAdapterCatalog().Register(factory));
        return services;
    }
}

test("unknown connector name makes Prepare throw naming the connector", async () =>
{
    const services = FederatedTestFixture.Services(new CountingAdapterFactory(DataSourceKind.Sql));
    const connector = new FederatedModelDataConnector(FederatedTestFixture.Plan("$&{1}missing"), { nodes: [], edges: [] });
    await assert.rejects(() => connector.Prepare(services), /unknown connector '\$&\{1\}missing'/);
});

test("mixed model keeps hand-authored nodes alongside pulled instances", async () =>
{
    const factory = new CountingAdapterFactory(DataSourceKind.Sql);
    factory.Seed("order", [{ order_id: "O-1", display_name: "Acme" }]);
    const handAuthored: JsonNode =
    {
        id: "a.Customer#c1", tier: "Instance", type: "a.Customer", metaKind: null, namespace: "a", localId: "Customer#c1",
        isClass: false, class: null, storageId: null, canonicalId: null, fields: [], attrs: { label: "Hand" },
    };
    const connector = new FederatedModelDataConnector(FederatedTestFixture.Plan("pg"), { nodes: [handAuthored], edges: [] });
    const doc = await connector.Prepare(FederatedTestFixture.Services(factory));
    assert.ok(doc.nodes.some((n) => n.id === "a.Customer#c1"));
    assert.ok(doc.nodes.some((n) => n.storageId === "O-1"));
});

test("Prepare retries after a failure", async () =>
{
    const factory = new CountingAdapterFactory(DataSourceKind.Sql);
    factory.Seed("order", [{ order_id: "O-1", display_name: "Acme" }]);
    factory.FailNext();
    const services = FederatedTestFixture.Services(factory);
    const connector = new FederatedModelDataConnector(FederatedTestFixture.Plan("pg"), { nodes: [], edges: [] });
    await assert.rejects(() => connector.Prepare(services));
    const doc = await connector.Prepare(services);
    assert.ok(doc.nodes.some((n) => n.storageId === "O-1"));
});

class RefreshFixture
{
    public static readonly Row1 = { order_id: "O-1", display_name: "Acme" };
    public static readonly Row2 = { order_id: "O-2", display_name: "Beta" };

    public static Factory(): CountingAdapterFactory
    {
        const factory = new CountingAdapterFactory(DataSourceKind.Sql);
        factory.Seed("order", [RefreshFixture.Row1]);
        return factory;
    }

    public static Connector(): FederatedModelDataConnector
    {
        return new FederatedModelDataConnector(FederatedTestFixture.Plan("pg"), { nodes: [], edges: [] });
    }
}

class SpyCatalog extends DataSourceAdapterCatalog
{
    private static readonly InvalidateMessage = "Invalidate must not be called by Refresh";

    public OpenCount = 0;
    public InvalidateCount = 0;

    public override Open(spec: ConnectorSpec, services: IServiceProvider): Promise<IDataSourceAdapter>
    {
        this.OpenCount++;
        return super.Open(spec, services);
    }

    public override async Invalidate(_spec: ConnectorSpec): Promise<void>
    {
        this.InvalidateCount++;
        throw new Error(SpyCatalog.InvalidateMessage);
    }
}

test("Refresh re-pulls changed source data into the existing connector", async () =>
{
    const factory = RefreshFixture.Factory();
    const services = FederatedTestFixture.Services(factory);
    const connector = RefreshFixture.Connector();
    const first = await connector.Prepare(services);
    assert.ok(first.nodes.some((n) => n.storageId === "O-1"));
    factory.Seed("order", [RefreshFixture.Row2]);
    const refreshed = await connector.Refresh(services);
    assert.ok(refreshed.nodes.some((n) => n.storageId === "O-2" && n.attrs["label"] === "Beta"));
    assert.ok(!refreshed.nodes.some((n) => n.storageId === "O-1"));
});

test("a failed Refresh leaves the previously built document intact and rethrows", async () =>
{
    const factory = RefreshFixture.Factory();
    const services = FederatedTestFixture.Services(factory);
    const connector = RefreshFixture.Connector();
    const first = await connector.Prepare(services);
    const decisionsBefore = connector.Decisions();
    factory.FailNext();
    await assert.rejects(() => connector.Refresh(services), /simulated query failure/);
    const after = await connector.Prepare(services);
    assert.equal(after, first);
    assert.ok(after.nodes.some((n) => n.storageId === "O-1"));
    assert.equal(connector.Decisions(), decisionsBefore);
});

class AuditFixture
{
    private static readonly Meta = `namespace shop
{
    concept Customer { customer_id : string; email : string; phone : string; }
    identity Customer key storageId;
    merge Customer { prefer source "opsdb.contacts" for email; prefer source "opsdb.crm_accounts" for phone; }
}`;

    private static Binding(source: string): ConnectorBinding
    {
        return { Concept: "shop.Customer", Connector: "opsdb", Source: source, IdKey: "customer_id", FieldMap: { customer_id: "customer_id", email: "email", phone: "phone" }, Writable: true, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential };
    }

    public static Connector(): FederatedModelDataConnector
    {
        const plan: ModelConnectorPlan = { Model: "shop", Version: "1", Connectors: [{ Name: "opsdb", Kind: DataSourceKind.Sql, Config: {} }], Bindings: [AuditFixture.Binding("contacts"), AuditFixture.Binding("crm_accounts")] };
        return new FederatedModelDataConnector(plan, toJSON(check([{ uri: "shop.todl", text: AuditFixture.Meta }]).model));
    }

    public static Services(events: ResolutionAuditEvent[]): ServiceProvider
    {
        const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
        factory.Adapter.Seed("contacts", [{ customer_id: "C1", email: "new@acme.com", phone: "555-NEW" }]);
        factory.Adapter.Seed("crm_accounts", [{ customer_id: "C1", email: "old@acme.com", phone: "555-OLD" }]);
        const services = new ServiceProvider();
        services.registerInstance(DataSourceAdapterCatalog.ServiceKey, new DataSourceAdapterCatalog().Register(factory));
        services.registerInstance(ResolutionAuditSinkKey, { Record: async (event: ResolutionAuditEvent) => { events.push(event); } });
        return services;
    }
}

test("Refresh re-emits resolution decisions to the audit sink", async () =>
{
    const events: ResolutionAuditEvent[] = [];
    const services = AuditFixture.Services(events);
    const connector = AuditFixture.Connector();
    await connector.Prepare(services);
    assert.equal(events.length, 1);
    await connector.Refresh(services);
    assert.equal(events.length, 2);
    assert.ok(events[1]!.decisions.length > 0);
    assert.equal(events[1]!.model, "shop");
});

test("Refresh rebinds the working copy and reports dropped pending ops via LastRefreshDiagnostics", async () =>
{
    const factory = RefreshFixture.Factory();
    const services = FederatedTestFixture.Services(factory);
    const connector = RefreshFixture.Connector();
    const first = await connector.Prepare(services);
    const id = first.nodes.find((n) => n.storageId === "O-1")!.id;
    const wc = connector.WorkingCopy();
    wc.MarkDirty(id);
    assert.equal(connector.LastRefreshDiagnostics().length, 0);
    factory.Seed("order", [RefreshFixture.Row2]);
    await connector.Refresh(services);
    const dropped = connector.LastRefreshDiagnostics();
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0]!.code, DiagnosticCode.ConnectorRefreshDropped);
    assert.ok(dropped[0]!.message.includes(id));
    assert.equal(connector.WorkingCopy(), wc);
});

test("Refresh reuses adapters via Open and never invalidates the catalog", async () =>
{
    const factory = RefreshFixture.Factory();
    const catalog = new SpyCatalog().Register(factory);
    const services = new ServiceProvider();
    services.registerInstance(DataSourceAdapterCatalog.ServiceKey, catalog);
    const connector = RefreshFixture.Connector();
    await connector.Prepare(services);
    assert.equal(catalog.OpenCount, 1);
    await connector.Refresh(services);
    assert.equal(catalog.OpenCount, 2);
    assert.equal(catalog.InvalidateCount, 0);
});

test("Refresh before Prepare throws NotPrepared", async () =>
{
    const services = FederatedTestFixture.Services(RefreshFixture.Factory());
    await assert.rejects(() => RefreshFixture.Connector().Refresh(services), /Prepare must complete before accessing connector results/);
});

test("a Refresh whose audit sink throws leaves the old built document intact", async () =>
{
    const events: ResolutionAuditEvent[] = [];
    const services = AuditFixture.Services(events);
    const connector = AuditFixture.Connector();
    const before = await connector.Prepare(services);
    const decisionsBefore = connector.Decisions();
    const sinkFailure = "simulated audit sink failure";
    services.registerInstance(ResolutionAuditSinkKey, { Record: async () => { throw new Error(sinkFailure); } });
    await assert.rejects(() => connector.Refresh(services), /simulated audit sink failure/);
    assert.equal(await connector.Prepare(services), before);
    assert.equal(connector.Decisions(), decisionsBefore);
});
