import { test } from "node:test";
import assert from "node:assert/strict";
import { SqlAdapter } from "../sql-adapter.js";
import { WriteAtomicity, WriteConcurrency, WriteFailureKind, WriteOperationKind } from "../connector-plan.js";
import type { WriteBatch, WriteOperation } from "../connector-plan.js";
import { FailingSqlSession, RecordingSqlSession } from "./sql-fakes.js";

class ApplyFixtures
{
    public static readonly UpsertSql = 'INSERT INTO "order" ("order_id", "display_name", "created_at") VALUES ($1, $2, $3) '
        + 'ON CONFLICT ("order_id") DO UPDATE SET "display_name" = EXCLUDED."display_name", "created_at" = EXCLUDED."created_at"';
    public static readonly VersionGuard = ' WHERE "order"."version" = $4';
    public static readonly DriverErrorMessage = "connection reset by peer";

    public static UpsertOp(version?: number, key = "O-1007"): WriteOperation
    {
        const op: WriteOperation = {
            Kind: WriteOperationKind.Upsert,
            Key: key,
            Fields: { display_name: "Acme reorder", created_at: "2020" },
        };
        return version === undefined ? op : { ...op, Version: version };
    }

    public static Batch(op: WriteOperation, versionField?: string, concurrency: WriteConcurrency = WriteConcurrency.LastWriteWins): WriteBatch
    {
        const batch: WriteBatch = { Source: "order", IdKey: "order_id", Operations: [op], Concurrency: concurrency, Atomicity: WriteAtomicity.Sequential };
        return versionField === undefined ? batch : { ...batch, VersionField: versionField };
    }

    public static SequentialBatch(ops: readonly WriteOperation[]): WriteBatch
    {
        return { Source: "order", IdKey: "order_id", Operations: ops, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential };
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
    assert.deepEqual(result.Failures, []);
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

test("LastWriteWins upsert overwrites regardless of stored version", async () =>
{
    // VersionField is set but Concurrency is LastWriteWins: no version guard is emitted, and the
    // upsert applies even though the fake reports 0 rows affected (we never inspect the rowcount).
    const session = new RecordingSqlSession([], 0);
    const result = await new SqlAdapter(session).Apply(ApplyFixtures.Batch(ApplyFixtures.UpsertOp(3), "version"));
    assert.equal(session.calls[0]!.sql, ApplyFixtures.UpsertSql);
    assert.equal(session.calls[0]!.sql.includes(ApplyFixtures.VersionGuard), false);
    assert.deepEqual(session.calls[0]!.params, ["O-1007", "Acme reorder", "2020"]);
    assert.equal(result.Applied, 1);
    assert.deepEqual(result.Failures, []);
});

test("Optimistic upsert on a version match applies, on mismatch is a Conflict failure", async () =>
{
    const match = new RecordingSqlSession([], 1);
    const applied = await new SqlAdapter(match).Apply(
        ApplyFixtures.Batch(ApplyFixtures.UpsertOp(3), "version", WriteConcurrency.Optimistic));
    assert.equal(match.calls[0]!.sql, ApplyFixtures.UpsertSql + ApplyFixtures.VersionGuard);
    assert.deepEqual(match.calls[0]!.params, ["O-1007", "Acme reorder", "2020", 3]);
    assert.equal(applied.Applied, 1);
    assert.deepEqual(applied.Failures, []);

    const mismatch = new RecordingSqlSession([], 0);
    const conflicted = await new SqlAdapter(mismatch).Apply(
        ApplyFixtures.Batch(ApplyFixtures.UpsertOp(3), "version", WriteConcurrency.Optimistic));
    assert.equal(conflicted.Applied, 0);
    assert.equal(conflicted.Failures.length, 1);
    assert.equal(conflicted.Failures[0]!.Key, "O-1007");
    assert.equal(conflicted.Failures[0]!.Kind, WriteFailureKind.Conflict);
});

test("Optimistic upsert on a present row whose version is NULL is a Conflict (fail-closed)", async () =>
{
    // The row exists but has no version; op carries no Version, so the guard binds NULL, matches no
    // row (rowcount 0), and must surface as a Conflict -- never a silent overwrite.
    const session = new RecordingSqlSession([], 0);
    const result = await new SqlAdapter(session).Apply(
        ApplyFixtures.Batch(ApplyFixtures.UpsertOp(), "version", WriteConcurrency.Optimistic));
    assert.equal(session.calls[0]!.sql, ApplyFixtures.UpsertSql + ApplyFixtures.VersionGuard);
    assert.deepEqual(session.calls[0]!.params, ["O-1007", "Acme reorder", "2020", null]);
    assert.equal(result.Applied, 0);
    assert.equal(result.Failures.length, 1);
    assert.equal(result.Failures[0]!.Kind, WriteFailureKind.Conflict);
});

test("Sequential apply collects a mid-batch driver Error and keeps applying the rest", async () =>
{
    const session = new FailingSqlSession(2, new Error(ApplyFixtures.DriverErrorMessage));
    const batch = ApplyFixtures.SequentialBatch([
        ApplyFixtures.UpsertOp(undefined, "O-1"),
        ApplyFixtures.UpsertOp(undefined, "O-2"),
        ApplyFixtures.UpsertOp(undefined, "O-3"),
    ]);
    const result = await new SqlAdapter(session).Apply(batch);
    assert.equal(session.calls.length, 3);
    assert.equal(result.Applied, 2);
    assert.equal(result.Failures.length, 1);
    assert.equal(result.Failures[0]!.Key, "O-2");
    assert.equal(result.Failures[0]!.Kind, WriteFailureKind.Error);
    assert.equal(result.Failures[0]!.Reason, ApplyFixtures.DriverErrorMessage);
});

test("SqlAdapter key-only upsert emits DO NOTHING without a version guard", async () =>
{
    const session = new RecordingSqlSession([], 0);
    const op: WriteOperation = { Kind: WriteOperationKind.Upsert, Key: "O-1007", Fields: {} };
    const result = await new SqlAdapter(session).Apply(ApplyFixtures.Batch(op));
    assert.equal(session.calls[0]!.sql, 'INSERT INTO "order" ("order_id") VALUES ($1) ON CONFLICT ("order_id") DO NOTHING');
    assert.deepEqual(session.calls[0]!.params, ["O-1007"]);
    assert.equal(result.Applied, 1);
    assert.deepEqual(result.Failures, []);
});

test("SqlAdapter key-only upsert ignores the batch VersionField", async () =>
{
    const session = new RecordingSqlSession([], 0);
    const op: WriteOperation = { Kind: WriteOperationKind.Upsert, Key: "O-1007", Fields: {}, Version: 3 };
    const result = await new SqlAdapter(session).Apply(ApplyFixtures.Batch(op, "version"));
    assert.equal(session.calls[0]!.sql, 'INSERT INTO "order" ("order_id") VALUES ($1) ON CONFLICT ("order_id") DO NOTHING');
    assert.deepEqual(session.calls[0]!.params, ["O-1007"]);
    assert.equal(result.Applied, 1);
    assert.deepEqual(result.Failures, []);
});
