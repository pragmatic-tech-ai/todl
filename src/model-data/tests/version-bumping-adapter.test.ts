import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceKind, WriteAtomicity, WriteConcurrency, WriteFailureKind, WriteOperationKind, type ResolvedConnection, type WriteBatch } from "../connector-plan.js";
import type { IDataSourceAdapter, IDataSourceContext } from "../data-source-adapter.js";
import { VersionBumpingAdapter } from "../version-bumping-adapter.js";
import { InMemoryAdapterFactory } from "./fakes.js";

class BumpFixture
{
    public static readonly Caller = "alice";
    public static readonly Source = "order";
    public static readonly IdKey = "id";

    public static async Adapter(): Promise<VersionBumpingAdapter>
    {
        const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
        factory.Adapter.Seed(BumpFixture.Source, [{ id: "O1", label: "a", ver: 7 }, { id: "O2", label: "b", ver: "etag-1" }]);
        return new VersionBumpingAdapter(await factory.Open({ Kind: DataSourceKind.Sql, Config: {} } as ResolvedConnection));
    }

    public static Batch(ops: WriteBatch["Operations"], concurrency = WriteConcurrency.Optimistic): WriteBatch
    {
        return { Source: BumpFixture.Source, IdKey: BumpFixture.IdKey, Operations: ops, Concurrency: concurrency, Atomicity: WriteAtomicity.Sequential, VersionField: "ver" };
    }

    public static async Row(adapter: VersionBumpingAdapter, id: string): Promise<Record<string, unknown> | undefined>
    {
        return (await adapter.Query({ Source: BumpFixture.Source, Fields: ["id", "label", "ver"] })).find(r => r[BumpFixture.IdKey] === id);
    }
}

test("an optimistic upsert without a new version is written with version + 1 and reports it; a stale writer then conflicts", async () =>
{
    const adapter = await BumpFixture.Adapter();
    const result = await adapter.Apply(BumpFixture.Batch([{ Kind: WriteOperationKind.Upsert, Key: "O1", Fields: { label: "x" }, Version: 7 }]));
    assert.deepEqual([result.Applied, result.Versions], [1, [{ Key: "O1", Version: 8 }]]);
    assert.equal((await BumpFixture.Row(adapter, "O1"))!["ver"], 8);
    const stale = await adapter.Apply(BumpFixture.Batch([{ Kind: WriteOperationKind.Upsert, Key: "O1", Fields: { label: "y" }, Version: 7 }]));
    assert.equal(stale.Failures[0]!.Kind, WriteFailureKind.Conflict);
    assert.equal(stale.Versions, undefined);
});

test("a caller-supplied new version, a non-numeric (etag) version and a last-write-wins batch are never bumped", async () =>
{
    const adapter = await BumpFixture.Adapter();
    const supplied = BumpFixture.Batch([{ Kind: WriteOperationKind.Upsert, Key: "O1", Fields: { label: "x", ver: 100 }, Version: 7 }]);
    assert.equal(VersionBumpingAdapter.Bumped(supplied).Operations[0]!.Fields["ver"], 100);
    const etag = BumpFixture.Batch([{ Kind: WriteOperationKind.Upsert, Key: "O2", Fields: { label: "x" }, Version: "etag-1" }]);
    assert.equal(VersionBumpingAdapter.Bumped(etag).Operations[0]!.Fields["ver"], undefined);
    const lww = BumpFixture.Batch([{ Kind: WriteOperationKind.Upsert, Key: "O1", Fields: { label: "x" }, Version: 7 }], WriteConcurrency.LastWriteWins);
    assert.equal(VersionBumpingAdapter.Bumped(lww), lww);
    const deletion = BumpFixture.Batch([{ Kind: WriteOperationKind.Delete, Key: "O1", Fields: {}, Version: 7 }]);
    assert.deepEqual(VersionBumpingAdapter.Bumped(deletion).Operations[0], deletion.Operations[0]);
});

test("optional capabilities stay absent when the wrapped adapter lacks them", async () =>
{
    const bare = new VersionBumpingAdapter({ Query: async () => [], Apply: async () => ({ Applied: 0, Failures: [] }), Dispose: async () => {} });
    assert.equal(bare.QueryPage, undefined);
    assert.equal(bare.ClassifyFailure, undefined);
    assert.equal(bare.CanPage, false);
});

test("a source that manages its own versions is passed through untouched and nothing is reported", async () =>
{
    const batches: WriteBatch[] = [];
    const inner = {
        SourceManagesVersions: true,
        Query: async () => [],
        Apply: async (batch: WriteBatch) => { batches.push(batch); return { Applied: batch.Operations.length, Failures: [] }; },
        Dispose: async () => {},
    };
    const adapter = new VersionBumpingAdapter(inner);
    const batch = BumpFixture.Batch([{ Kind: WriteOperationKind.Upsert, Key: "O1", Fields: { label: "x" }, Version: 7 }]);
    const result = await adapter.Apply(batch);
    assert.equal(batches[0], batch);
    assert.equal(result.Versions, undefined);
    assert.equal(adapter.SourceManagesVersions, true);
});

test("only ops the wrapper bumped are reported", async () =>
{
    const adapter = await BumpFixture.Adapter();
    const result = await adapter.Apply(BumpFixture.Batch([
        { Kind: WriteOperationKind.Upsert, Key: "O1", Fields: { label: "x" }, Version: 7 },
        { Kind: WriteOperationKind.Upsert, Key: "O2", Fields: { label: "y" }, Version: "etag-1" },
    ]));
    assert.deepEqual(result.Versions, [{ Key: "O1", Version: 8 }]);
});

test("the bumped Apply keeps its context", async () =>
{
    const seen: (IDataSourceContext | undefined)[] = [];
    const inner: IDataSourceAdapter = {
        Query: async (_request, context) => { seen.push(context); return []; },
        QueryPage: async (_request, _page, context) => { seen.push(context); return { Records: [] }; },
        Apply: async (_batch, context) => { seen.push(context); return { Applied: 1, Failures: [] }; },
        Dispose: async () => {},
    };
    const caller: IDataSourceContext = { Key: BumpFixture.Caller };
    const adapter = new VersionBumpingAdapter(inner);
    const result = await adapter.Apply(BumpFixture.Batch([{ Kind: WriteOperationKind.Upsert, Key: "O1", Fields: { label: "x" }, Version: 7 }]), caller);
    assert.deepEqual(result.Versions, [{ Key: "O1", Version: 8 }]);
    await adapter.Query({ Source: BumpFixture.Source, Fields: [BumpFixture.IdKey] }, caller);
    await adapter.QueryPage!({ Source: BumpFixture.Source, Fields: [BumpFixture.IdKey] }, { Limit: 1 }, caller);
    assert.equal(seen.length, 3);
    assert.ok(seen.every((c) => c === caller));
});
