import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceKind, WriteOperationKind } from "../connector-plan.js";
import { CountingAdapterFactory, InMemoryAdapter } from "./fakes.js";
import { describeDataSourceAdapter } from "./data-source-adapter-conformance.js";

describeDataSourceAdapter("InMemoryAdapter (write)", () =>
{
    return new InMemoryAdapter().Seed("Customer", [{ id: "c1", label: "Acme" }]);
});

describeDataSourceAdapter("CountingAdapter (write)", () =>
{
    const factory = new CountingAdapterFactory(DataSourceKind.Sql);
    factory.Seed("Customer", [{ id: "c1", label: "Acme" }]);
    let adapter: Awaited<ReturnType<CountingAdapterFactory["Open"]>> | undefined;
    // Open is async but resolves synchronously-equivalent; wrap lazily.
    return {
        Query: async request => (adapter ??= await factory.Open({} as never)).Query(request),
        Apply: async batch => (adapter ??= await factory.Open({} as never)).Apply(batch),
    };
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
