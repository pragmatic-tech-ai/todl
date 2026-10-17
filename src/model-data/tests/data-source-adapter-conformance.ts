import { test } from "node:test";
import assert from "node:assert/strict";
import { WriteAtomicity, WriteConcurrency, WriteOperationKind } from "../connector-plan.js";
import type { IDataSourceAdapter } from "../data-source-adapter.js";

/**
  * Contract every data-source adapter must satisfy. The adapter returned by
  * `make` must hold source "Customer" seeded with a record { id: "c1", label: "Acme" }.
  */
export function describeDataSourceAdapter(name: string, make: () => IDataSourceAdapter): void
{
    test(`${name}: Query returns only the requested fields per record`, async () => {
        const rows = await make().Query({ Source: "Customer", Fields: ["id", "label"] });
        assert.equal(rows.length, 1);
        assert.deepEqual(Object.keys(rows[0]!).sort(), ["id", "label"]);
        assert.equal(rows[0]!.id, "c1");
    });

    test(`${name}: an unknown source yields no records`, async () => {
        const rows = await make().Query({ Source: "Nope", Fields: ["id"] });
        assert.deepEqual(rows, []);
    });

    test(`${name}: projecting a subset of fields drops the others`, async () => {
        const rows = await make().Query({ Source: "Customer", Fields: ["id"] });
        assert.deepEqual(rows[0], { id: "c1" });
        assert.equal("label" in rows[0]!, false);
    });

    test(`${name}: Apply upserts a new row that Query then returns`, async () => {
        const adapter = make();
        const result = await adapter.Apply({
            Source: "Customer", IdKey: "id", Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential,
            Operations: [{ Kind: WriteOperationKind.Upsert, Key: "c2", Fields: { label: "Globex" } }],
        });
        assert.equal(result.Applied, 1);
        assert.equal(result.Failures.length, 0);
        const rows = await adapter.Query({ Source: "Customer", Fields: ["id", "label"] });
        assert.equal(rows.length, 2);
        assert.deepEqual(rows.find(r => r.id === "c2"), { id: "c2", label: "Globex" });
    });

    test(`${name}: Apply upsert on an existing key overwrites`, async () => {
        const adapter = make();
        await adapter.Apply({
            Source: "Customer", IdKey: "id", Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential,
            Operations: [{ Kind: WriteOperationKind.Upsert, Key: "c1", Fields: { label: "Acme 2" } }],
        });
        const rows = await adapter.Query({ Source: "Customer", Fields: ["id", "label"] });
        assert.deepEqual(rows, [{ id: "c1", label: "Acme 2" }]);
    });

    test(`${name}: Apply delete removes the row`, async () => {
        const adapter = make();
        const result = await adapter.Apply({
            Source: "Customer", IdKey: "id", Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential,
            Operations: [{ Kind: WriteOperationKind.Delete, Key: "c1", Fields: {} }],
        });
        assert.equal(result.Applied, 1);
        assert.deepEqual(await adapter.Query({ Source: "Customer", Fields: ["id"] }), []);
    });
}
