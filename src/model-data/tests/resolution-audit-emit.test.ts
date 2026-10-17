import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider, CompositionRoot } from "@pragmatic-tech-ai/todl-runtime";
import { check } from "../../compiler-services/api.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import { DataSourceKind, WriteConcurrency, WriteAtomicity } from "../connector-plan.js";
import type { ModelConnectorPlan, ConnectorBinding } from "../connector-plan.js";
import { FederatedModelDataConnector } from "../federated-model-data-connector.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import { InMemoryAdapterFactory } from "./fakes.js";
import { ResolutionAuditSinkKey } from "../resolution-audit-sink.js";
import type { IResolutionAuditSink, ResolutionAuditEvent } from "../resolution-audit-sink.js";
import { ModelDataSource } from "../model-data-source.js";
import { ModelRegistry } from "../model-registry.js";
import { ApplicationBootstrapper } from "../../application/application-bootstrapper.js";

class RecordingSink implements IResolutionAuditSink
{
    public readonly events: ResolutionAuditEvent[] = [];
    public Record(event: ResolutionAuditEvent): Promise<void>
    {
        this.events.push(event);
        return Promise.resolve();
    }
}

class ThrowingSink implements IResolutionAuditSink
{
    public Record(_event: ResolutionAuditEvent): Promise<void>
    {
        return Promise.reject(new Error("sink down"));
    }
}

class CrmHarness
{
    private static readonly Meta = `namespace shop
{
    concept Customer { customer_id : string; email : string; phone : string; }
    identity Customer key storageId;
    merge Customer { prefer source "opsdb.contacts" for email; prefer source "opsdb.crm_accounts" for phone; }
}`;

    private static readonly PlainMeta = `namespace shop
{
    concept Customer { customer_id : string; email : string; phone : string; }
}`;

    public static Binding(source: string): ConnectorBinding
    {
        return { Concept: "shop.Customer", Connector: "opsdb", Source: source, IdKey: "customer_id", FieldMap: { customer_id: "customer_id", email: "email", phone: "phone" }, Writable: true, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential };
    }

    public static Plan(bindings: ConnectorBinding[]): ModelConnectorPlan
    {
        return { Model: "shop", Version: "1", Connectors: [{ Name: "opsdb", Kind: DataSourceKind.Sql, Config: {} }], Bindings: bindings };
    }

    public static Base(merge: boolean)
    {
        return toJSON(check([{ uri: "shop.todl", text: merge ? CrmHarness.Meta : CrmHarness.PlainMeta }]).model);
    }

    public static Catalog(): DataSourceAdapterCatalog
    {
        const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
        factory.Adapter.Seed("contacts", [{ customer_id: "C1", email: "new@acme.com", phone: "555-NEW" }]);
        factory.Adapter.Seed("crm_accounts", [{ customer_id: "C1", email: "old@acme.com", phone: "555-OLD" }]);
        return new DataSourceAdapterCatalog().Register(factory);
    }

    public static Services(sink?: IResolutionAuditSink): ServiceProvider
    {
        const services = new ServiceProvider();
        services.registerInstance(DataSourceAdapterCatalog.ServiceKey, CrmHarness.Catalog());
        if (sink !== undefined) { services.registerInstance(ResolutionAuditSinkKey, sink); }
        return services;
    }

    public static Connector(merge: boolean): FederatedModelDataConnector
    {
        return new FederatedModelDataConnector(CrmHarness.Plan([CrmHarness.Binding("contacts"), CrmHarness.Binding("crm_accounts")]), CrmHarness.Base(merge));
    }
}

class ShopModel extends ModelDataSource
{
    public constructor(connector: FederatedModelDataConnector)
    {
        super(connector);
        this.modelName = "shop";
        this.modelVersion = "1";
    }
}

test("no sink registered: Prepare succeeds and emits nothing (optional/no-op)", async () =>
{
    const connector = CrmHarness.Connector(true);
    const doc = await connector.Prepare(CrmHarness.Services());
    assert.ok(doc.nodes.length > 0);
    assert.ok(connector.Decisions().length > 0);
});

test("a registered sink receives the merge decisions equal to Decisions()", async () =>
{
    const sink = new RecordingSink();
    const connector = CrmHarness.Connector(true);
    await connector.Prepare(CrmHarness.Services(sink));
    assert.equal(sink.events.length, 1);
    assert.equal(sink.events[0]!.model, "shop");
    assert.deepEqual(sink.events[0]!.decisions, connector.Decisions());
    assert.ok(sink.events[0]!.decisions.some((d) => d.source === "opsdb.contacts"));
});

test("a non-merging model (no identity/merge meta) emits no event", async () =>
{
    const sink = new RecordingSink();
    const connector = CrmHarness.Connector(false);
    await connector.Prepare(CrmHarness.Services(sink));
    assert.equal(sink.events.length, 0);
});

test("the recorded event carries names only — no secret or connection value", async () =>
{
    const sink = new RecordingSink();
    const connector = CrmHarness.Connector(true);
    await connector.Prepare(CrmHarness.Services(sink));
    const json = JSON.stringify(sink.events);
    assert.equal(json.includes("opsdb.contacts"), true); // sanity: names flowed
    assert.equal(json.includes("555-"), false); // decisions carry no attribute values
    assert.equal(json.includes("password"), false);
    assert.equal(json.includes("Config"), false);
});

test("a sink that rejects makes Prepare reject (fail-closed)", async () =>
{
    const connector = CrmHarness.Connector(true);
    await assert.rejects(() => connector.Prepare(CrmHarness.Services(new ThrowingSink())), /sink down/);
});

test("bootstrap path: a connector driven by BootRegistry emits to a sink on root.Provider", async () =>
{
    const sink = new RecordingSink();
    const root = new CompositionRoot();
    root.Provider.registerInstance(DataSourceAdapterCatalog.ServiceKey, CrmHarness.Catalog());
    root.Provider.registerInstance(ResolutionAuditSinkKey, sink); // registered BEFORE Boot
    const registry = new ModelRegistry();
    registry.Register("shop", new ShopModel(CrmHarness.Connector(true)));
    registry.SetRoot("shop");
    await ApplicationBootstrapper.BootRegistry(registry, root);
    assert.equal(sink.events.length, 1);
    assert.equal(sink.events[0]!.model, "shop");
    assert.ok(sink.events[0]!.decisions.length > 0);
});
