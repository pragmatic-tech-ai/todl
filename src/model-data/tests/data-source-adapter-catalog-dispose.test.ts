import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import { DataSourceKind } from "../connector-plan.js";
import type { ConnectorSpec, ExternalRecord, QueryRequest, ResolvedConnection, WriteBatch, WriteResult } from "../connector-plan.js";
import type { IDataSourceAdapter, IDataSourceAdapterFactory } from "../data-source-adapter.js";

class DisposeCountingAdapter implements IDataSourceAdapter
{
    public disposed = 0;

    public constructor(private readonly throwOnDispose = false)
    {
    }

    public async Query(_r: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        return [];
    }

    public async Apply(_b: WriteBatch): Promise<WriteResult>
    {
        return { Applied: 0, Conflicts: [] };
    }

    public async Dispose(): Promise<void>
    {
        this.disposed++;
        if (this.throwOnDispose) throw new Error(DisposeCountingAdapter.BoomMessage);
    }

    private static readonly BoomMessage = "boom";
}

class SingleAdapterFactory implements IDataSourceAdapterFactory
{
    public constructor(public readonly Kind: DataSourceKind, public readonly Adapter: DisposeCountingAdapter)
    {
    }

    public async Open(_c: ResolvedConnection): Promise<IDataSourceAdapter>
    {
        return this.Adapter;
    }
}

class DisposeSpecs
{
    public static Of(name: string, kind: DataSourceKind = DataSourceKind.Sql): ConnectorSpec
    {
        return { Name: name, Kind: kind, Config: {} };
    }
}

test("Dispose disposes every memoized adapter and clears the cache", async () =>
{
    const adapter = new DisposeCountingAdapter();
    const catalog = new DataSourceAdapterCatalog().Register(new SingleAdapterFactory(DataSourceKind.Sql, adapter));
    const services = new ServiceProvider();
    const opened = await catalog.Open(DisposeSpecs.Of("a"), services);
    assert.equal(opened, adapter);
    await catalog.Dispose();
    assert.equal(adapter.disposed, 1);
    await catalog.Dispose();
    assert.equal(adapter.disposed, 1);
});

test("Dispose on an empty catalog resolves and is idempotent", async () =>
{
    const catalog = new DataSourceAdapterCatalog();
    await catalog.Dispose();
    await catalog.Dispose();
    assert.ok(true);
});

test("one adapter's Dispose throwing does not stop the others or block clearing", async () =>
{
    const bad = new DisposeCountingAdapter(true);
    const good = new DisposeCountingAdapter();
    const services = new ServiceProvider();
    const catalog = new DataSourceAdapterCatalog();
    catalog.Register(new SingleAdapterFactory(DataSourceKind.Sql, bad));
    catalog.Register(new SingleAdapterFactory(DataSourceKind.Rest, good));
    await catalog.Open(DisposeSpecs.Of("x", DataSourceKind.Sql), services);
    await catalog.Open(DisposeSpecs.Of("y", DataSourceKind.Rest), services);
    await catalog.Dispose();
    assert.equal(bad.disposed, 1);
    assert.equal(good.disposed, 1);
});
