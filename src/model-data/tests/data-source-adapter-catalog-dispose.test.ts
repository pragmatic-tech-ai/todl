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
        return { Applied: 0, Failures: [] };
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

class RejectingFactory implements IDataSourceAdapterFactory
{
    private static readonly OpenFailedMessage = "open failed";

    public readonly Kind = DataSourceKind.Sql;

    public async Open(_c: ResolvedConnection): Promise<IDataSourceAdapter>
    {
        throw new Error(RejectingFactory.OpenFailedMessage);
    }
}

class FreshAdapterFactory implements IDataSourceAdapterFactory
{
    public readonly Kind = DataSourceKind.Sql;
    public readonly Created: DisposeCountingAdapter[] = [];

    public async Open(_c: ResolvedConnection): Promise<IDataSourceAdapter>
    {
        const adapter = new DisposeCountingAdapter();
        this.Created.push(adapter);
        return adapter;
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
    assert.notEqual(opened, adapter);
    await catalog.Dispose();
    assert.equal(adapter.disposed, 1);
    await catalog.Dispose();
    assert.equal(adapter.disposed, 1);
});

test("Dispose on an empty catalog resolves and is idempotent", async () =>
{
    const catalog = new DataSourceAdapterCatalog();
    await assert.doesNotReject(() => catalog.Dispose());
    await assert.doesNotReject(() => catalog.Dispose());
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

test("a rejected Open is swallowed by Dispose", async () =>
{
    const catalog = new DataSourceAdapterCatalog().Register(new RejectingFactory());
    // Do NOT await Open: its rejection is asynchronous, so the failed entry is still in the memo
    // map when Dispose snapshots it. Dispose then awaits that rejecting promise; without the
    // per-entry try/catch in Dispose this test would fail with the rejection.
    const opening = catalog.Open(DisposeSpecs.Of("r"), new ServiceProvider());
    opening.catch(() => {});
    const disposing = catalog.Dispose();
    await assert.doesNotReject(() => disposing);
});

test("Open after Dispose yields a fresh working adapter", async () =>
{
    const factory = new FreshAdapterFactory();
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const services = new ServiceProvider();
    const first = await catalog.Open(DisposeSpecs.Of("a"), services);
    await catalog.Dispose();
    const second = await catalog.Open(DisposeSpecs.Of("a"), services);
    assert.notEqual(second, first);
    assert.equal(factory.Created.length, 2);
    assert.deepEqual(await second.Query({} as QueryRequest), []);
});
