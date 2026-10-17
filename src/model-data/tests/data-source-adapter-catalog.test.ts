import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceKind, type ConnectorSpec, type ResolvedConnection } from "../connector-plan.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import {
    ConnectionResolverKey,
    type IConnectionResolver,
    type IDataSourceAdapter,
    type IDataSourceAdapterFactory,
    type IDataSourceAdapterProvider,
} from "../data-source-adapter.js";
import { InMemoryAdapter, InMemoryAdapterFactory, RegisteredAdapterProvider } from "./fakes.js";
import { describeDataSourceAdapter } from "./data-source-adapter-conformance.js";
import { ServiceProvider, type IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";

describeDataSourceAdapter("InMemoryAdapter", () =>
{
    const a = new InMemoryAdapter();
    a.Seed("Customer", [{ id: "c1", label: "Acme" }]);
    return a;
});

test("catalog opens a registered factory and memoizes per connector name", async () =>
{
    const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
    const catalog = new DataSourceAdapterCatalog();
    catalog.Register(factory);
    const services = new ServiceProvider();
    const spec = { Name: "pg", Kind: DataSourceKind.Sql, Config: {}, Connection: "crm" };
    const first = await catalog.Open(spec, services);
    const second = await catalog.Open(spec, services);
    assert.equal(first, second);
});

test("catalog memoizes by qualified Id: same bare Name in different namespaces gets distinct adapters", async () =>
{
    const factory = new RecordingFactory(DataSourceKind.Sql);
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const services = new ServiceProvider();
    // Two different connectors that share the bare local name "pg".
    const shopPg = { Id: "shop.pg", Name: "pg", Kind: DataSourceKind.Sql, Config: { db: "shop" } };
    const inventoryPg = { Id: "inventory.pg", Name: "pg", Kind: DataSourceKind.Sql, Config: { db: "inventory" } };
    const a1 = await catalog.Open(shopPg, services);
    const a2 = await catalog.Open(inventoryPg, services);
    const a1Again = await catalog.Open(shopPg, services);
    assert.notEqual(a1, a2);          // distinct declarations -> distinct adapters (no bare-name collision)
    assert.equal(a1, a1Again);        // same declaration -> memoized
    assert.equal(factory.Opens, 2);
});

test("catalog falls back to bare Name when a spec carries no Id", async () =>
{
    const factory = new RecordingFactory(DataSourceKind.Sql);
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const services = new ServiceProvider();
    const spec = { Name: "pg", Kind: DataSourceKind.Sql, Config: {} };   // hand-written, no Id
    const first = await catalog.Open(spec, services);
    const second = await catalog.Open(spec, services);
    assert.equal(first, second);
    assert.equal(factory.Opens, 1);
});

test("catalog falls back to the provider when no factory is registered", async () =>
{
    const provider = new RegisteredAdapterProvider();
    provider.Add(new InMemoryAdapterFactory(DataSourceKind.Rest));
    const catalog = new DataSourceAdapterCatalog(provider);
    const opened = await catalog.Open({ Name: "api", Kind: DataSourceKind.Rest, Config: {} }, new ServiceProvider());
    assert.ok(opened);
});

test("catalog rejects an unresolvable kind with a connector diagnostic message", async () =>
{
    const catalog = new DataSourceAdapterCatalog();
    await assert.rejects(
        () => catalog.Open({ Name: "x", Kind: DataSourceKind.Document, Config: {} }, new ServiceProvider()),
        /connector/i,
    );
});

test("a registered factory wins over the provider", async () =>
{
    const registered = new InMemoryAdapterFactory(DataSourceKind.Sql);
    const provided = new InMemoryAdapterFactory(DataSourceKind.Sql);
    const provider = new RegisteredAdapterProvider().Add(provided);
    const catalog = new DataSourceAdapterCatalog(provider).Register(registered);
    const opened = await catalog.Open({ Name: "pg", Kind: DataSourceKind.Sql, Config: {} }, new ServiceProvider());
    assert.equal(opened, registered.Adapter);
    assert.notEqual(opened, provided.Adapter);
});

class RecordingFactory implements IDataSourceAdapterFactory
{
    public Received: ResolvedConnection | undefined;
    public FailuresLeft = 0;
    public Opens = 0;

    public constructor(public readonly Kind: DataSourceKind)
    {
    }

    public async Open(connection: ResolvedConnection): Promise<IDataSourceAdapter>
    {
        this.Opens++;
        this.Received = connection;
        if (this.FailuresLeft-- > 0) throw new Error("boom");
        return new InMemoryAdapter();
    }
}

class SentinelResolver implements IConnectionResolver
{
    public async Resolve(spec: ConnectorSpec, _services: IServiceProvider): Promise<ResolvedConnection>
    {
        return { Kind: spec.Kind, Config: { sentinel: "yes" } };
    }
}

test("catalog resolves the connection through a ConnectionResolverKey service", async () =>
{
    const factory = new RecordingFactory(DataSourceKind.Sql);
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const services = new ServiceProvider();
    services.registerInstance(ConnectionResolverKey, new SentinelResolver());
    await catalog.Open({ Name: "pg", Kind: DataSourceKind.Sql, Config: { sentinel: "no" } }, services);
    assert.deepEqual(factory.Received?.Config, { sentinel: "yes" });
});

test("a failed Open is evicted from the memo so a second call retries", async () =>
{
    const factory = new RecordingFactory(DataSourceKind.Sql);
    factory.FailuresLeft = 1;
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const services = new ServiceProvider();
    const spec = { Name: "pg", Kind: DataSourceKind.Sql, Config: {} };
    await assert.rejects(() => catalog.Open(spec, services), /boom/);
    const retried = await catalog.Open(spec, services);
    assert.ok(retried);
    assert.equal(factory.Opens, 2);
});

test("provider failure is wrapped with cause, and names with replacement tokens stay intact", async () =>
{
    const original = new Error("provider down");
    const provider: IDataSourceAdapterProvider = {
        Resolve: async () =>
        {
            throw original;
        },
    };
    const catalog = new DataSourceAdapterCatalog(provider);
    const name = "a$&b{1}$1";
    await assert.rejects(
        () => catalog.Open({ Name: name, Kind: DataSourceKind.Cypher, Config: {} }, new ServiceProvider()),
        (e: Error) => e.cause === original && e.message.includes(`'${name}'`) && e.message.includes("'cypher'"),
    );
});
