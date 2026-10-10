import { test } from "node:test";
import assert from "node:assert/strict";
import { SqlAdapter } from "../sql-adapter.js";
import { WriteOperationKind } from "../connector-plan.js";
import type { WriteBatch, WriteOperation } from "../connector-plan.js";
import { RecordingSqlSession } from "./sql-fakes.js";

class ApplyFixtures
{
    public static readonly UpsertSql = 'INSERT INTO "order" ("order_id", "display_name", "created_at") VALUES ($1, $2, $3) '
        + 'ON CONFLICT ("order_id") DO UPDATE SET "display_name" = EXCLUDED."display_name", "created_at" = EXCLUDED."created_at"';

    public static UpsertOp(version?: number): WriteOperation
    {
        const op: WriteOperation = {
            Kind: WriteOperationKind.Upsert,
            Key: "O-1007",
            Fields: { display_name: "Acme reorder", created_at: "2020" },
        };
        return version === undefined ? op : { ...op, Version: version };
    }

    public static Batch(op: WriteOperation, versionField?: string): WriteBatch
    {
        const batch: WriteBatch = { Source: "order", IdKey: "order_id", Operations: [op] };
        return versionField === undefined ? batch : { ...batch, VersionField: versionField };
    }
}

test("SqlAdapter upsert emits a parameterized INSERT ... ON CONFLICT", async () =>
{
    const session = new RecordingSqlSession();
    const result = await new SqlAdapter(session).Apply(ApplyFixtures.Batch(ApplyFixtures.UpsertOp()));
    assert.equal(session.calls.length, 1);
    assert.equal(session.calls[0]!.sql, ApplyFixtures.UpsertSql);
    assert.deepEqual(session.calls[0]!.params, ["O-1007", "Acme reorder", "2020"]);
    assert.equal(result.Applied, 1);
    assert.deepEqual(result.Conflicts, []);
});

test("SqlAdapter delete emits a parameterized DELETE", async () =>
{
    const session = new RecordingSqlSession();
    const op: WriteOperation = { Kind: WriteOperationKind.Delete, Key: "O-1007", Fields: {} };
    const result = await new SqlAdapter(session).Apply(ApplyFixtures.Batch(op));
    assert.equal(session.calls[0]!.sql, 'DELETE FROM "order" WHERE "order_id" = $1');
    assert.deepEqual(session.calls[0]!.params, ["O-1007"]);
    assert.equal(result.Applied, 1);
});

test("SqlAdapter optimistic upsert reports a conflict when no row is updated", async () =>
{
    const session = new RecordingSqlSession([], 0);
    const result = await new SqlAdapter(session).Apply(ApplyFixtures.Batch(ApplyFixtures.UpsertOp(3), "version"));
    assert.equal(session.calls[0]!.sql, ApplyFixtures.UpsertSql + ' WHERE "order"."version" = $4');
    assert.deepEqual(session.calls[0]!.params, ["O-1007", "Acme reorder", "2020", 3]);
    assert.equal(result.Applied, 0);
    assert.equal(result.Conflicts.length, 1);
    assert.equal(result.Conflicts[0]!.Key, "O-1007");
});

test("SqlAdapter optimistic upsert applies when a row is updated", async () =>
{
    const session = new RecordingSqlSession([], 1);
    const result = await new SqlAdapter(session).Apply(ApplyFixtures.Batch(ApplyFixtures.UpsertOp(3), "version"));
    assert.equal(result.Applied, 1);
    assert.deepEqual(result.Conflicts, []);
});

test("SqlAdapter key-only upsert emits DO NOTHING without a version guard", async () =>
{
    const session = new RecordingSqlSession([], 0);
    const op: WriteOperation = { Kind: WriteOperationKind.Upsert, Key: "O-1007", Fields: {} };
    const result = await new SqlAdapter(session).Apply(ApplyFixtures.Batch(op));
    assert.equal(session.calls[0]!.sql, 'INSERT INTO "order" ("order_id") VALUES ($1) ON CONFLICT ("order_id") DO NOTHING');
    assert.deepEqual(session.calls[0]!.params, ["O-1007"]);
    assert.equal(result.Applied, 1);
    assert.deepEqual(result.Conflicts, []);
});

test("SqlAdapter key-only upsert ignores the batch VersionField", async () =>
{
    const session = new RecordingSqlSession([], 0);
    const op: WriteOperation = { Kind: WriteOperationKind.Upsert, Key: "O-1007", Fields: {}, Version: 3 };
    const result = await new SqlAdapter(session).Apply(ApplyFixtures.Batch(op, "version"));
    assert.equal(session.calls[0]!.sql, 'INSERT INTO "order" ("order_id") VALUES ($1) ON CONFLICT ("order_id") DO NOTHING');
    assert.deepEqual(session.calls[0]!.params, ["O-1007"]);
    assert.equal(result.Applied, 1);
    assert.deepEqual(result.Conflicts, []);
});

test("SqlAdapter optimistic upsert with a missing Version binds NULL and conflicts", async () =>
{
    const session = new RecordingSqlSession([], 0);
    const result = await new SqlAdapter(session).Apply(ApplyFixtures.Batch(ApplyFixtures.UpsertOp(), "version"));
    assert.deepEqual(session.calls[0]!.params, ["O-1007", "Acme reorder", "2020", null]);
    assert.equal(result.Applied, 0);
    assert.equal(result.Conflicts.length, 1);
});
