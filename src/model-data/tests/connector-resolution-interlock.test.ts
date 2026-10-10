import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { check } from "../../compiler-services/api.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import { DataSourceKind } from "../connector-plan.js";
import type { ModelConnectorPlan, ConnectorBinding } from "../connector-plan.js";
import { FederatedModelDataConnector } from "../federated-model-data-connector.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import { InMemoryAdapterFactory } from "./fakes.js";

class CrmHarness
{
    private static readonly Meta = `namespace shop
{
    concept Customer { customer_id : string; email : string; phone : string; }
    identity Customer key storageId;
    merge Customer { prefer source "opsdb.contacts" for email; prefer source "opsdb.crm_accounts" for phone; }
}`;

    public static Binding(source: string): ConnectorBinding
    {
        return { Concept: "shop.Customer", Connector: "opsdb", Source: source, IdKey: "customer_id", FieldMap: { customer_id: "customer_id", email: "email", phone: "phone" }, Writable: true };
    }

    private static PlanFor(bindings: ConnectorBinding[]): ModelConnectorPlan
    {
        return { Model: "shop", Version: "1", Connectors: [{ Name: "opsdb", Kind: DataSourceKind.Sql, Config: {} }], Bindings: bindings };
    }

    private static Services(): ServiceProvider
    {
        const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
        factory.Adapter.Seed("contacts", [{ customer_id: "C1", email: "new@acme.com", phone: "555-NEW" }]);
        factory.Adapter.Seed("crm_accounts", [{ customer_id: "C1", email: "old@acme.com", phone: "555-OLD" }]);
        const catalog = new DataSourceAdapterCatalog().Register(factory);
        const services = new ServiceProvider();
        services.registerInstance(DataSourceAdapterCatalog.ServiceKey, catalog);
        return services;
    }

    public static async Resolved(bindings: ConnectorBinding[]): Promise<{ email: unknown; phone: unknown; count: number }>
    {
        const base = toJSON(check([{ uri: "shop.todl", text: CrmHarness.Meta }]).model);
        const connector = new FederatedModelDataConnector(CrmHarness.PlanFor(bindings), base);
        const doc = await connector.Prepare(CrmHarness.Services());
        const instances = doc.nodes.filter((n) => n.type === "shop.Customer" && n.tier === "Instance");
        const c = instances[0]!;
        return { email: c.attrs.email, phone: c.attrs.phone, count: instances.length };
    }
}

test("CRM migration: two tables of one datasource merge into one canonical with per-table survivorship", async () =>
{
    const r = await CrmHarness.Resolved([CrmHarness.Binding("contacts"), CrmHarness.Binding("crm_accounts")]);
    assert.equal(r.count, 1);
    assert.equal(r.email, "new@acme.com");
    assert.equal(r.phone, "555-OLD");
});

test("merge is deterministic regardless of binding order", async () =>
{
    const forward = await CrmHarness.Resolved([CrmHarness.Binding("contacts"), CrmHarness.Binding("crm_accounts")]);
    const reversed = await CrmHarness.Resolved([CrmHarness.Binding("crm_accounts"), CrmHarness.Binding("contacts")]);
    assert.deepEqual(forward, reversed);
});
