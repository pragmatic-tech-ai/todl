import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { Repository } from "../../compiler-services/model/model.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import { ModelDataSource } from "../model-data-source.js";
import { ModelShardExtractor } from "../model-shard-extractor.js";
import { FederatedModelDataConnector } from "../federated-model-data-connector.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import { DataSourceKind, WriteConcurrency, WriteAtomicity, type ModelConnectorPlan } from "../connector-plan.js";
import { CountingAdapterFactory } from "./fakes.js";

class ReflectionFixture
{
    public static readonly ModelId = "sales";
    public static readonly Concept = "Order";

    public static BaseShard()
    {
        const r = new Repository();
        const b = r.builder();
        b.definePrimitive("string");
        b.defineConcept(ReflectionFixture.Concept);
        b.addField(ReflectionFixture.Concept, "label", "string");
        b.assertModel(ReflectionFixture.ModelId);
        b.commit();
        return ModelShardExtractor.Extract(toJSON(r), ReflectionFixture.ModelId);
    }
}

class OrderModel extends ModelDataSource
{
    public constructor(connector: FederatedModelDataConnector)
    {
        super(connector);
        this.modelName = ReflectionFixture.ModelId;
        this.modelVersion = "0.0.0";
    }
}

test("a federated population is reflected through the model data source", async () =>
{
    const factory = new CountingAdapterFactory(DataSourceKind.Sql);
    factory.Seed("order", [{ order_id: "O-1007", display_name: "Acme reorder" }]);
    const services = new ServiceProvider();
    services.registerInstance(DataSourceAdapterCatalog.ServiceKey, new DataSourceAdapterCatalog().Register(factory));

    const plan: ModelConnectorPlan =
    {
        Model: ReflectionFixture.ModelId, Version: "0.0.0",
        Connectors: [{ Name: "pg", Kind: DataSourceKind.Sql, Config: {} }],
        Bindings: [{ Concept: ReflectionFixture.Concept, Connector: "pg", Source: "order", IdKey: "order_id", FieldMap: { id: "order_id", label: "display_name" }, Writable: true, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential }],
    };
    const source = new OrderModel(new FederatedModelDataConnector(plan, ReflectionFixture.BaseShard()));
    await source.Prepare(services);

    const orders = source.Instances(ReflectionFixture.Concept);
    assert.equal(orders.length, 1, "the populated Order is reflected");
    assert.ok(orders[0]!.id.includes("O-1007"), `instance id carries the storage key: ${orders[0]!.id}`);
});
