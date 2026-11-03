import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceKind, WriteAtomicity, WriteConcurrency, WriteFailureKind, WriteOperationKind, type ResolvedConnection, type WriteBatch } from "../connector-plan.js";
import { VersionBumpingAdapter } from "../version-bumping-adapter.js";
import { InMemoryAdapterFactory } from "./fakes.js";

class BumpFixture
{
    public static async Adapter(): Promise<VersionBumpingAdapter>
    {
        const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
        factory.Adapter.Seed("order", [{ id: "O1", label: "a", ver: 7 }, { id: "O2", label: "b", ver: "etag-1" }]);
        return new VersionBumpingAdapter(await factory.Open({ Kind: DataSourceKind.Sql, Config: {} } as ResolvedConnection));
    }

    public static Batch(ops: WriteBatch["Operations"], concurrency = WriteConcurrency.Optimistic): WriteBatch
    {
        return { Source: "order", IdKey: "id", Operations: ops, Concurrency: concurrency, Atomicity: WriteAtomicity.Sequential, VersionField: "ver" };
    }

    public static async Row(adapter: VersionBumpingAdapter, id: string): Promise<Record<string, unknown> | undefined>
    {
        return (await adapter.Query({ Source: "order", Fields: ["id", "label", "ver"] })).find(r => r["id"] === id);
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
