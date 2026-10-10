import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceKind, WriteOperationKind, type ResolvedConnection } from "../connector-plan.js";
import type { IDataSourceAdapter } from "../data-source-adapter.js";
import { CountingAdapterFactory, InMemoryAdapter } from "./fakes.js";
import { describeDataSourceAdapter } from "./data-source-adapter-conformance.js";

// InMemoryAdapter's conformance battery runs once, in data-source-adapter-catalog.test.ts.
const StubConnection: ResolvedConnection = { Kind: DataSourceKind.Sql, Config: {} };

// Open is async, but the conformance factory is synchronous, so open lazily on first use.
describeDataSourceAdapter("CountingAdapter", () =>
{
    const factory = new CountingAdapterFactory(DataSourceKind.Sql);
    factory.Seed("Customer", [{ id: "c1", label: "Acme" }]);
    let adapter: IDataSourceAdapter | undefined;
    const open = async (): Promise<IDataSourceAdapter> => (adapter ??= await factory.Open(StubConnection));
    return {
        Query: async request => (await open()).Query(request),
        Apply: async batch => (await open()).Apply(batch),
    };
});

test("a mixed batch applies one op and conflicts the other", async () =>
{
    const adapter = new InMemoryAdapter().Seed("Customer", [
        { id: "c1", label: "A", v: 1 },
        { id: "c2", label: "B", v: 1 },
    ]);
    const result = await adapter.Apply({
        Source: "Customer", IdKey: "id", VersionField: "v",
        Operations: [
            { Kind: WriteOperationKind.Upsert, Key: "c1", Fields: { label: "A2", v: 2 }, Version: 1 },
            { Kind: WriteOperationKind.Upsert, Key: "c2", Fields: { label: "B2", v: 2 }, Version: 0 },
        ],
    });
    assert.equal(result.Applied, 1);
    assert.equal(result.Conflicts.length, 1);
    assert.equal(result.Conflicts[0]!.Key, "c2");
    const rows = await adapter.Query({ Source: "Customer", Fields: ["id", "label"] });
    assert.deepEqual(rows, [{ id: "c1", label: "A2" }, { id: "c2", label: "B" }]);
});

test("deleting a missing key is not counted and does not throw", async () =>
{
    const adapter = new InMemoryAdapter().Seed("Customer", [{ id: "c1", label: "Acme" }]);
    const result = await adapter.Apply({
        Source: "Customer", IdKey: "id",
        Operations: [{ Kind: WriteOperationKind.Delete, Key: "zzz", Fields: {} }],
    });
    assert.equal(result.Applied, 0);
    assert.equal(result.Conflicts.length, 0);
    assert.equal((await adapter.Query({ Source: "Customer", Fields: ["id"] })).length, 1);
});

test("Seed isolates the adapter from the caller's array", async () =>
{
    const seed = [{ id: "c1", label: "Acme" }];
    const adapter = new InMemoryAdapter().Seed("Customer", seed);
    await adapter.Apply({
        Source: "Customer", IdKey: "id",
        Operations: [{ Kind: WriteOperationKind.Delete, Key: "c1", Fields: {} }],
    });
    assert.equal(seed.length, 1);
});

test("Apply upserts a new row and an existing key; Query reflects both", async () =>
{
    const adapter = new InMemoryAdapter().Seed("Customer", [{ id: "c1", label: "Acme", v: 1 }]);
    const result = await adapter.Apply({
        Source: "Customer", IdKey: "id",
        Operations: [
            { Kind: WriteOperationKind.Upsert, Key: "c2", Fields: { label: "Globex", v: 1 } },
            { Kind: WriteOperationKind.Upsert, Key: "c1", Fields: { label: "Acme 2", v: 2 } },
        ],
    });
    assert.equal(result.Applied, 2);
    const rows = await adapter.Query({ Source: "Customer", Fields: ["id", "label"] });
    assert.deepEqual(rows, [{ id: "c1", label: "Acme 2" }, { id: "c2", label: "Globex" }]);
});

test("a stale Version yields a conflict and leaves the row unchanged", async () =>
{
    const adapter = new InMemoryAdapter().Seed("Customer", [{ id: "c1", label: "Acme", v: 5 }]);
    const result = await adapter.Apply({
        Source: "Customer", IdKey: "id", VersionField: "v",
        Operations: [{ Kind: WriteOperationKind.Upsert, Key: "c1", Fields: { label: "Hacked", v: 6 }, Version: 4 }],
    });
    assert.equal(result.Applied, 0);
    assert.equal(result.Conflicts.length, 1);
    assert.equal(result.Conflicts[0]!.Key, "c1");
    const rows = await adapter.Query({ Source: "Customer", Fields: ["label", "v"] });
    assert.deepEqual(rows, [{ label: "Acme", v: 5 }]);
});

test("a matching Version is written", async () =>
{
    const adapter = new InMemoryAdapter().Seed("Customer", [{ id: "c1", label: "Acme", v: 5 }]);
    const result = await adapter.Apply({
        Source: "Customer", IdKey: "id", VersionField: "v",
        Operations: [{ Kind: WriteOperationKind.Upsert, Key: "c1", Fields: { label: "Ok", v: 6 }, Version: 5 }],
    });
    assert.equal(result.Applied, 1);
    assert.equal(result.Conflicts.length, 0);
});
