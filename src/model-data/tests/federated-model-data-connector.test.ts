import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { FederatedModelDataConnector } from "../federated-model-data-connector.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import { CountingAdapterFactory } from "./fakes.js";
import type { JsonNode } from "../../compiler-services/emit/json.js";
import { DataSourceKind, WriteConcurrency, WriteAtomicity, type ModelConnectorPlan } from "../connector-plan.js";

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
