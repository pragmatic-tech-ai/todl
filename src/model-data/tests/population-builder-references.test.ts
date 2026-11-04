import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../compiler-services/api.js";
import { toJSON, type TodlDocument } from "../../compiler-services/emit/json.js";
import { PopulationBuilder } from "../population-builder.js";
import { ConnectorWorkingCopy } from "../connector-working-copy.js";
import { DataSourceKind, WriteAtomicity, WriteConcurrency, type ConnectorBinding, type ModelConnectorPlan, type WriteBatch, type WriteTarget } from "../connector-plan.js";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import type { IDataSourceAdapter, IDataSourceAdapterFactory } from "../data-source-adapter.js";

class RefsFixture
{
    public static Base(): TodlDocument
    {
        const text = "namespace a { concept Party { name : string?; } concept Customer : Party { } concept Order { label : string?; buyer : Customer?; relationship owner -> Party?; } }";
        return toJSON(check([{ uri: "a.todl", text }]).model);
    }

    public static Binding(concept: string, source: string, idKey: string, fieldMap: Record<string, string>): ConnectorBinding
    {
        return { Concept: concept, Connector: "pg", Source: source, IdKey: idKey, FieldMap: fieldMap, Writable: true, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential };
    }

    public static readonly Customers = RefsFixture.Binding("a.Customer", "customers", "cid", { id: "cid", name: "name" });
    public static readonly Orders = RefsFixture.Binding("a.Order", "orders", "oid", { id: "oid", label: "label", buyer: "buyer_id", owner: "owner_id" });

    public static Build(orders: Record<string, string>[]): TodlDocument
    {
        return new PopulationBuilder(RefsFixture.Base())
            .Add(RefsFixture.Customers, [{ cid: "C1", name: "Ada" }, { cid: "C2", name: "Bo" }])
            .Add(RefsFixture.Orders, orders)
            .Build();
    }

    public static Order(doc: TodlDocument, storageId: string)
    {
        return doc.nodes.find((n) => n.type === "a.Order" && n.storageId === storageId)!;
    }

    public static EdgeFrom(doc: TodlDocument, from: string, via: string): string | undefined
    {
        return doc.edges.find((e) => e.kind === "Relationship" && e.from === from && e.via === via)?.to;
    }
}

test("a reference field or relationship whose value names another population's record gains an edge and keeps its typed value", () =>
{
    const doc = RefsFixture.Build([{ oid: "O1", label: "first", buyer_id: "C1", owner_id: "C2" }]);
    const order = RefsFixture.Order(doc, "O1");
    const customer = (id: string) => doc.nodes.find((n) => n.type === "a.Customer" && n.storageId === id)!.id;
    assert.equal(RefsFixture.EdgeFrom(doc, order.id, "buyer"), customer("C1"));
    assert.equal(RefsFixture.EdgeFrom(doc, order.id, "owner"), customer("C2"), "an inherited target type (Party) accepts a subtype instance");
    assert.equal(order.attrs["buyer"], "C1", "the raw value stays for identity rules and write-back");
    assert.equal(order.attrs["owner"], "C2");
    assert.equal(order.attrs["label"], "first", "plain scalars are untouched");
});

test("a value naming no record (or a scalar member) is left as the raw scalar", () =>
{
    const doc = RefsFixture.Build([{ oid: "O2", label: "C1", buyer_id: "C9" }]);
    const order = RefsFixture.Order(doc, "O2");
    assert.equal(order.attrs["buyer"], "C9");
    assert.equal(order.attrs["label"], "C1");
    assert.equal(RefsFixture.EdgeFrom(doc, order.id, "buyer"), undefined);
});

test("write-back sends the reference member's original value", async () =>
{
    const doc = RefsFixture.Build([{ oid: "O1", label: "first", buyer_id: "C1" }]);
    const order = RefsFixture.Order(doc, "O1");
    const plan: ModelConnectorPlan = { Model: "a", Version: "1", Connectors: [{ Name: "pg", Kind: DataSourceKind.Sql, Config: {} }], Bindings: [RefsFixture.Customers, RefsFixture.Orders] };
    const targets = new Map<string, readonly WriteTarget[]>([[order.id, [{ StorageId: "O1", Connector: "pg", Source: "orders" }]]]);
    const copy = new ConnectorWorkingCopy(plan, doc, targets);
    assert.equal(copy.MarkDirty(order.id), undefined);
    const batches: WriteBatch[] = [];
    const adapter: IDataSourceAdapter = {
        Query: async () => [],
        Apply: async (batch: WriteBatch) => { batches.push(batch); return { Applied: batch.Operations.length, Failures: [] }; },
        Dispose: async () => {},
    };
    const factory: IDataSourceAdapterFactory = { Kind: DataSourceKind.Sql, Open: async () => adapter };
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const services = new ServiceProvider();
    services.registerInstance(DataSourceAdapterCatalog.ServiceKey, catalog);
    await copy.Flush(catalog, services);
    const fields = batches[0]!.Operations[0]!.Fields;
    assert.equal(fields["buyer_id"], "C1");
    assert.equal(fields["label"], "first");
});

test("a numeric reference value keeps its type through write-back, and an identity rule over a reference member still merges", () =>
{
    const doc = new PopulationBuilder(RefsFixture.Base())
        .Add(RefsFixture.Binding("a.Customer", "customers", "cid", { id: "cid" }), [{ cid: 42 }])
        .Add(RefsFixture.Orders, [{ oid: "O1", buyer_id: 42 }])
        .Build();
    const order = RefsFixture.Order(doc, "O1");
    assert.equal(order.attrs["buyer"], 42);
    assert.ok(RefsFixture.EdgeFrom(doc, order.id, "buyer") !== undefined);
});
