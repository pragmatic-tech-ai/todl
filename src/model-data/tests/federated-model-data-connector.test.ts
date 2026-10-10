import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { FederatedModelDataConnector } from "../federated-model-data-connector.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import { CountingAdapterFactory } from "./fakes.js";
import { DataSourceKind, type ModelConnectorPlan } from "../connector-plan.js";

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
        Bindings: [{ Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "order_id", FieldMap: { id: "order_id", label: "display_name" }, Writable: true }],
    };
    const connector = new FederatedModelDataConnector(plan, { nodes: [], edges: [] });
    const first = await connector.Prepare(services);
    assert.ok(first.nodes.some((n) => n.storageId === "O-1" && n.attrs["label"] === "Acme"));
    const second = await connector.Prepare(services);
    assert.equal(second, first);
    assert.equal(factory.QueryCount, 1, "idempotent: no re-query on second Prepare");
});
