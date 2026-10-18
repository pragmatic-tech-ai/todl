import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DataSourceKind,
    type ConnectorSpec,
    type ExternalRecord,
    type QueryRequest,
    type ResolvedConnection,
    type WriteBatch,
    type WriteResult,
} from "../connector-plan.js";
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
import { ConnectionFailureKind, ReconnectObserverKey } from "../connection-reconnect.js";
import type { IReconnectObserver, ReconnectEvent } from "../connection-reconnect.js";

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
    registered.Adapter.Seed("t", [{ id: "registered" }]);
    provided.Adapter.Seed("t", [{ id: "provided" }]);
    const opened = await catalog.Open({ Name: "pg", Kind: DataSourceKind.Sql, Config: {} }, new ServiceProvider());
    assert.deepEqual(await opened.Query({ Source: "t", Fields: ["id"] }), [{ id: "registered" }]);
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

test("a connector that names a provider resolves through the provider, not a Kind-registered factory", async () =>
{
    const registered = new InMemoryAdapterFactory(DataSourceKind.Sql);
    const packFactory = new InMemoryAdapterFactory(DataSourceKind.Sql);
    registered.Adapter.Seed("t", [{ id: "registered" }]);
    packFactory.Adapter.Seed("t", [{ id: "pack" }]);
    const provider = new RegisteredAdapterProvider().Add(packFactory);
    const catalog = new DataSourceAdapterCatalog(provider).Register(registered);
    const opened = await catalog.Open(
        { Name: "pg", Kind: DataSourceKind.Sql, Config: {}, Provider: "@x/pg@1.0.0" }, new ServiceProvider());
    assert.deepEqual(await opened.Query({ Source: "t", Fields: ["id"] }), [{ id: "pack" }]);
});

test("a named provider with no provider configured is fail-closed", async () =>
{
    const catalog = new DataSourceAdapterCatalog().Register(new InMemoryAdapterFactory(DataSourceKind.Sql));
    await assert.rejects(
        () => catalog.Open({ Name: "pg", Kind: DataSourceKind.Sql, Config: {}, Provider: "@x/pg@1.0.0" }, new ServiceProvider()),
        /no adapter provider is configured/);
});

test("a named provider that rejects is fail-closed (no fall back to a Kind factory)", async () =>
{
    const registered = new InMemoryAdapterFactory(DataSourceKind.Sql);
    const provider: IDataSourceAdapterProvider = { Resolve: async () => { throw new Error("pack boom"); } };
    const catalog = new DataSourceAdapterCatalog(provider).Register(registered);
    await assert.rejects(
        () => catalog.Open({ Name: "pg", Kind: DataSourceKind.Sql, Config: {}, Provider: "@x/pg@1.0.0" }, new ServiceProvider()),
        /pack boom/);
});

class TaggedAuthError extends Error
{
}

class SecretCapturingAdapter implements IDataSourceAdapter
{
    public Disposed = 0;

    public constructor(public readonly Secret: string | undefined, private readonly failAuthOnce: boolean)
    {
    }

    public async Query(_request: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        if (this.failAuthOnce) throw new TaggedAuthError("auth");
        return [{ secret: this.Secret ?? null }];
    }

    public async Apply(_batch: WriteBatch): Promise<WriteResult>
    {
        return { Applied: 0, Failures: [] };
    }

    public async Dispose(): Promise<void>
    {
        this.Disposed++;
    }

    public ClassifyFailure(error: unknown): ConnectionFailureKind
    {
        return error instanceof TaggedAuthError ? ConnectionFailureKind.Auth : ConnectionFailureKind.Permanent;
    }
}

class SecretCapturingFactory implements IDataSourceAdapterFactory
{
    public readonly Created: SecretCapturingAdapter[] = [];

    public constructor(public readonly Kind: DataSourceKind, private readonly firstFailsAuth: boolean = false)
    {
    }

    public async Open(connection: ResolvedConnection): Promise<IDataSourceAdapter>
    {
        const adapter = new SecretCapturingAdapter(connection.Secret, this.firstFailsAuth && this.Created.length === 0);
        this.Created.push(adapter);
        return adapter;
    }
}

class FlippableResolver implements IConnectionResolver
{
    public constructor(public Secret: string)
    {
    }

    public async Resolve(spec: ConnectorSpec, _services: IServiceProvider): Promise<ResolvedConnection>
    {
        return { Kind: spec.Kind, Config: spec.Config, Secret: this.Secret };
    }
}

test("Invalidate disposes and drops the memoized adapter so the next Open rebuilds it", async () =>
{
    const factory = new SecretCapturingFactory(DataSourceKind.Sql);
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const services = new ServiceProvider();
    const spec = { Name: "pg", Kind: DataSourceKind.Sql, Config: {} };
    const first = await catalog.Open(spec, services);
    assert.equal(await catalog.Open(spec, services), first);
    await catalog.Invalidate(spec);
    assert.equal(factory.Created[0]?.Disposed, 1);
    const third = await catalog.Open(spec, services);
    assert.notEqual(third, first);
    assert.equal(factory.Created.length, 2);
});

test("Invalidate uses the same key as Open for an Id-bearing and a bare-Name spec", async () =>
{
    const factory = new SecretCapturingFactory(DataSourceKind.Sql);
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const services = new ServiceProvider();
    const withId = { Id: "shop.pg", Name: "pg", Kind: DataSourceKind.Sql, Config: {} };
    const bare = { Name: "pg", Kind: DataSourceKind.Sql, Config: {} };
    await catalog.Open(withId, services);
    await catalog.Invalidate(withId);
    await catalog.Open(withId, services);
    assert.equal(factory.Created.length, 2);
    await catalog.Open(bare, services);
    await catalog.Invalidate(bare);
    await catalog.Open(bare, services);
    assert.equal(factory.Created.length, 4);
});

test("Invalidate on an unopened spec is a no-op", async () =>
{
    const factory = new SecretCapturingFactory(DataSourceKind.Sql);
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    await assert.doesNotReject(() => catalog.Invalidate({ Name: "pg", Kind: DataSourceKind.Sql, Config: {} }));
    assert.equal(factory.Created.length, 0);
});

test("a reopen after an Auth failure re-resolves the secret", async () =>
{
    const factory = new SecretCapturingFactory(DataSourceKind.Sql, true);
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const resolver = new FlippableResolver("old");
    const services = new ServiceProvider();
    services.registerInstance(ConnectionResolverKey, resolver);
    const adapter = await catalog.Open({ Name: "pg", Kind: DataSourceKind.Sql, Config: {} }, services);
    resolver.Secret = "new";
    const rows = await adapter.Query({ Source: "t", Fields: ["secret"] });
    assert.deepEqual(rows, [{ secret: "new" }]);
    assert.equal(factory.Created.length, 2);
    assert.equal(factory.Created[0]?.Secret, "old");
    assert.equal(factory.Created[1]?.Secret, "new");
});

test("Dispose still disposes all memoized adapters", async () =>
{
    const factory = new SecretCapturingFactory(DataSourceKind.Sql);
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const services = new ServiceProvider();
    await catalog.Open({ Name: "a", Kind: DataSourceKind.Sql, Config: {} }, services);
    await catalog.Open({ Name: "b", Kind: DataSourceKind.Sql, Config: {} }, services);
    await catalog.Dispose();
    assert.deepEqual(factory.Created.map(a => a.Disposed), [1, 1]);
});

class RecordingObserver implements IReconnectObserver
{
    public readonly Events: ReconnectEvent[] = [];

    public OnReconnect(event: ReconnectEvent): void
    {
        this.Events.push(event);
    }
}

test("Invalidate of one spec leaves another spec's memoized adapter untouched", async () =>
{
    const factory = new SecretCapturingFactory(DataSourceKind.Sql);
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const services = new ServiceProvider();
    const specA = { Name: "a", Kind: DataSourceKind.Sql, Config: {} };
    const specB = { Name: "b", Kind: DataSourceKind.Sql, Config: {} };
    const wrapperA = await catalog.Open(specA, services);
    const wrapperB = await catalog.Open(specB, services);
    await catalog.Invalidate(specA);
    assert.equal(factory.Created[0]?.Disposed, 1);
    assert.equal(factory.Created[1]?.Disposed, 0);
    assert.equal(await catalog.Open(specB, services), wrapperB);
    assert.notEqual(await catalog.Open(specA, services), wrapperA);
    assert.equal(factory.Created.length, 3);
});

test("a registered reconnect observer is passed through to the wrapper", async () =>
{
    const factory = new SecretCapturingFactory(DataSourceKind.Sql, true);
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const observer = new RecordingObserver();
    const services = new ServiceProvider();
    services.registerInstance(ReconnectObserverKey, observer);
    const adapter = await catalog.Open({ Name: "pg", Kind: DataSourceKind.Sql, Config: {} }, services);
    await adapter.Query({ Source: "t", Fields: ["secret"] });
    assert.ok(observer.Events.length >= 1);
    assert.equal(observer.Events[0]?.Connector, "pg");
});
