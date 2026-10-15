import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { DataSourceKind, type ConnectorBinding, type ConnectorSpec, type ModelConnectorPlan, type ResolvedConnection } from "../connector-plan.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import type { IDataSourceAdapter, IDataSourceAdapterFactory } from "../data-source-adapter.js";
import { ConnectorPrefetch, type INodeReflector } from "../connector-prefetch.js";
import { ConnectorMirrorMapper } from "../connector-mirror-mapper.js";
import type { InstanceMirror, ReflectedNode } from "../../manifest/reflection/reflection.js";
import { InMemoryAdapterFactory } from "./fakes.js";

class StubReflector implements INodeReflector
{
    public reflect(node: ReflectedNode): InstanceMirror
    {
        return { node } as unknown as InstanceMirror;
    }
}

class ThrowingFactory implements IDataSourceAdapterFactory
{
    public constructor(public readonly Kind: DataSourceKind)
    {
    }

    public async Open(_connection: ResolvedConnection): Promise<IDataSourceAdapter>
    {
        throw new Error("cannot open");
    }
}

class Fixture
{
    public static readonly Concept = "ns.Widget";
    public static readonly Spec: ConnectorSpec = { Name: "pg", Kind: DataSourceKind.Sql, Config: {} };
    public static readonly Binding: ConnectorBinding =
    {
        Concept: Fixture.Concept,
        Connector: "pg",
        Source: "widgets",
        IdKey: "pk",
        FieldMap: { id: "pk", label: "name" },
        Writable: false,
    };
    public static readonly Plan: ModelConnectorPlan =
    {
        Model: "m",
        Version: "1",
        Connectors: [Fixture.Spec],
        Bindings: [Fixture.Binding],
    };
}

test("prefetch mints a mirror per record with mapped attrs and the synthetic id", async () =>
{
    const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
    factory.Adapter.Seed("widgets", [{ pk: "1", name: "Alpha" }, { pk: "2", name: "Beta" }]);
    const catalog = new DataSourceAdapterCatalog().Register(factory);

    const snapshot = await ConnectorPrefetch.ForConcepts([Fixture.Concept], Fixture.Plan, catalog, new ServiceProvider(), new StubReflector());

    const mirrors = snapshot.get(Fixture.Concept)!;
    assert.equal(mirrors.length, 2);
    assert.equal(mirrors[0]!.node.id, "ns.Widget#pg.widgets#1");
    assert.equal(mirrors[0]!.node.type, "ns.Widget");
    assert.equal(mirrors[0]!.node.namespace, "ns");
    assert.deepEqual(mirrors[0]!.node.attrs, { label: "Alpha" });
    assert.deepEqual(mirrors[1]!.node.attrs, { label: "Beta" });
});

test("prefetch is fail-closed when the adapter cannot be opened", async () =>
{
    const catalog = new DataSourceAdapterCatalog().Register(new ThrowingFactory(DataSourceKind.Sql));

    const snapshot = await ConnectorPrefetch.ForConcepts([Fixture.Concept], Fixture.Plan, catalog, new ServiceProvider(), new StubReflector());

    assert.deepEqual(snapshot.get(Fixture.Concept), []);
});

test("prefetch skips concepts with no binding and de-duplicates requests", async () =>
{
    const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
    factory.Adapter.Seed("widgets", [{ pk: "1", name: "Alpha" }]);
    const catalog = new DataSourceAdapterCatalog().Register(factory);

    const snapshot = await ConnectorPrefetch.ForConcepts(["ns.Native", Fixture.Concept, Fixture.Concept], Fixture.Plan, catalog, new ServiceProvider(), new StubReflector());

    assert.equal(snapshot.size, 1);
    assert.equal(snapshot.get(Fixture.Concept)!.length, 1);
});

test("mapper drops records lacking an id", () =>
{
    assert.equal(ConnectorMirrorMapper.NodeFor(Fixture.Binding, { name: "x" }), undefined);
    assert.equal(ConnectorMirrorMapper.NodeFor(Fixture.Binding, { pk: null, name: "x" }), undefined);
});
