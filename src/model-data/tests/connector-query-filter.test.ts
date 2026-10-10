import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { check } from "../../compiler-services/api.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import { DataSourceKind, QueryCompareOp } from "../connector-plan.js";
import type { ModelConnectorPlan } from "../connector-plan.js";
import { FederatedModelDataConnector, type IConnectorQueryFilterProvider } from "../federated-model-data-connector.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import { InMemoryAdapterFactory } from "./fakes.js";

class FilterHarness
{
    private static readonly Concept = "shop.Customer";
    private static readonly Meta = `namespace shop
{
    concept Customer { customer_id : string; region : string; }
    identity Customer key storageId;
}`;

    private static Plan(): ModelConnectorPlan
    {
        return {
            Model: "shop", Version: "1",
            Connectors: [{ Name: "opsdb", Kind: DataSourceKind.Sql, Config: {} }],
            Bindings: [{ Concept: FilterHarness.Concept, Connector: "opsdb", Source: "customers", IdKey: "customer_id", FieldMap: { customer_id: "customer_id", region: "region" }, Writable: false }]
        };
    }

    private static Services(): ServiceProvider
    {
        const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
        factory.Adapter.Seed("customers", [
            { customer_id: "C1", region: "eu" },
            { customer_id: "C2", region: "us" },
            { customer_id: "C3", region: "eu" }
        ]);
        const services = new ServiceProvider();
        services.registerInstance(DataSourceAdapterCatalog.ServiceKey, new DataSourceAdapterCatalog().Register(factory));
        return services;
    }

    public static EuOnly(): IConnectorQueryFilterProvider
    {
        return { WhereFor: (concept) => concept === FilterHarness.Concept ? { All: [{ Field: "region", Op: QueryCompareOp.Eq, Value: "eu" }] } : undefined };
    }

    public static async Regions(provider: IConnectorQueryFilterProvider | undefined): Promise<unknown[]>
    {
        const base = toJSON(check([{ uri: "shop.todl", text: FilterHarness.Meta }]).model);
        const connector = new FederatedModelDataConnector(FilterHarness.Plan(), base);
        if (provider) connector.UseQueryFilterProvider(provider);
        const doc = await connector.Prepare(FilterHarness.Services());
        return doc.nodes.filter((n) => n.type === FilterHarness.Concept && n.tier === "Instance").map((n) => n.attrs.region);
    }
}

test("an installed provider pushes its Where into the connector query", async () =>
{
    const regions = await FilterHarness.Regions(FilterHarness.EuOnly());
    assert.deepEqual(regions, ["eu", "eu"]);
});

test("with no provider installed every row populates", async () =>
{
    const regions = await FilterHarness.Regions(undefined);
    assert.equal(regions.length, 3);
});
