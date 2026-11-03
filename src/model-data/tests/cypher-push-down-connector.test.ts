import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { check } from "../../compiler-services/api.js";
import { toJSON, type TodlDocument } from "../../compiler-services/emit/json.js";
import { FrozenGraph } from "../../domain/graph.js";
import { GraphQuery } from "../../graph-api/graph-query-engine.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { PackageManifestBridge } from "../../solution-services/package-manager/package-manifest-bridge.js";
import { CypherEngine } from "../../cypher/engine.js";
import { GraphQueryAdapter } from "../../cypher/graph.js";
import { CypherPushDown, GraphQuerySchema } from "../../cypher/push-down.js";
import { DataSourceKind, QueryCompareOp, WriteAtomicity, WriteConcurrency, type ModelConnectorPlan, type QueryFilter } from "../connector-plan.js";
import { FederatedModelDataConnector, type IConnectorQueryFilterProvider } from "../federated-model-data-connector.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import { InMemoryAdapterFactory } from "./fakes.js";

// A source whose column names differ from the model's members: push-down filters name model members and the connector
// must translate them through the binding's FieldMap before the adapter sees them.
class PushDownHarness
{
    public static readonly Concept = "shop.Customer";
    private static readonly Model = "shop";
    private static readonly Version = "1.0.0";
    private static readonly Meta = `namespace shop
{
    concept Customer { customer_id : string; region : string?; tier : string?; }
    identity Customer key storageId;
}`;

    public static Base(): TodlDocument
    {
        return toJSON(check([{ uri: "shop.todl", text: PushDownHarness.Meta }]).model);
    }

    private static Plan(): ModelConnectorPlan
    {
        return {
            Model: PushDownHarness.Model, Version: PushDownHarness.Version,
            Connectors: [{ Name: "opsdb", Kind: DataSourceKind.Sql, Config: {} }],
            Bindings: [{
                Concept: PushDownHarness.Concept, Connector: "opsdb", Source: "customers", IdKey: "CUST_ID",
                FieldMap: { customer_id: "CUST_ID", region: "REGION_CODE", tier: "TIER" },
                Writable: false, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential,
            }],
        };
    }

    private static Services(): ServiceProvider
    {
        const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
        factory.Adapter.Seed("customers", [
            { CUST_ID: "C1", REGION_CODE: "eu", TIER: "gold" },
            { CUST_ID: "C2", REGION_CODE: "us", TIER: "gold" },
            { CUST_ID: "C3", REGION_CODE: "eu", TIER: "basic" },
            { CUST_ID: "C4", REGION_CODE: null, TIER: "gold" },
        ]);
        const services = new ServiceProvider();
        services.registerInstance(DataSourceAdapterCatalog.ServiceKey, new DataSourceAdapterCatalog().Register(factory));
        return services;
    }

    public static Graph(doc: TodlDocument): GraphQuery
    {
        const resolved = PackageManifestBridge.toResolvedJsonDocument(doc, PushDownHarness.Model, PushDownHarness.Version, []);
        const manifest = Manifest.load(resolved.manifest);
        const graph = new FrozenGraph();
        graph.PreRegister(manifest);
        graph.Finalize(manifest);
        if (resolved.seed !== undefined) graph.BindSeed(resolved.seed, { model: PushDownHarness.Model, version: PushDownHarness.Version });
        return new GraphQuery(graph);
    }

    public static async Populate(provider: IConnectorQueryFilterProvider | undefined): Promise<TodlDocument>
    {
        const connector = new FederatedModelDataConnector(PushDownHarness.Plan(), PushDownHarness.Base());
        connector.UseQueryFilterProvider(provider);
        return connector.Prepare(PushDownHarness.Services());
    }

    public static Ids(doc: TodlDocument): string[]
    {
        return doc.nodes.filter((n) => n.type === PushDownHarness.Concept && n.storageId !== null).map((n) => String(n.storageId)).sort();
    }

    public static Run(doc: TodlDocument, query: string): unknown[]
    {
        const rows = new CypherEngine(new GraphQueryAdapter(PushDownHarness.Graph(doc))).Execute(query).Rows;
        return rows.map((r) => JSON.stringify(r)).sort();
    }

    public static Fixed(filter: QueryFilter): IConnectorQueryFilterProvider
    {
        return { WhereFor: (concept) => (concept === PushDownHarness.Concept ? filter : undefined) };
    }
}

describe("Cypher WHERE push-down through a connector", () =>
{
    test("filter terms are translated from model members to the binding's external fields", async () =>
    {
        const doc = await PushDownHarness.Populate(PushDownHarness.Fixed({ All: [{ Field: "region", Op: QueryCompareOp.Eq, Value: "eu" }] }));
        assert.deepEqual(PushDownHarness.Ids(doc), ["C1", "C3"]);
    });

    test("terms on unmapped members or the id member are dropped, widening the pull", async () =>
    {
        const filter: QueryFilter = { All: [
            { Field: "unknown", Op: QueryCompareOp.Eq, Value: "x" },
            { Field: "customer_id", Op: QueryCompareOp.Eq, Value: "C9" },
            { Field: "tier", Op: QueryCompareOp.Eq, Value: "gold" },
        ] };
        assert.deepEqual(PushDownHarness.Ids(await PushDownHarness.Populate(PushDownHarness.Fixed(filter))), ["C1", "C2", "C4"]);
        const none: QueryFilter = { All: [{ Field: "toString", Op: QueryCompareOp.Eq, Value: "x" }] };
        assert.deepEqual(PushDownHarness.Ids(await PushDownHarness.Populate(PushDownHarness.Fixed(none))).length, 4);
    });

    test("a pushed query pulls less and returns exactly what the unfiltered query returns", async () =>
    {
        const schema = new GraphQuerySchema(PushDownHarness.Graph(PushDownHarness.Base()));
        const query = "MATCH (c:Customer {tier: 'gold'}) WHERE c.region = 'eu' RETURN c.region AS region, c.tier AS tier";
        const full = await PushDownHarness.Populate(undefined);
        const pushed = await PushDownHarness.Populate(CypherPushDown.Analyze(query, schema));
        assert.deepEqual(PushDownHarness.Ids(pushed), ["C1"]);
        assert.deepEqual(PushDownHarness.Run(pushed, query), PushDownHarness.Run(full, query));
        assert.equal(PushDownHarness.Run(full, query).length, 1);
    });
});
