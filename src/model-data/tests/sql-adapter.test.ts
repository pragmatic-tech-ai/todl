import { test } from "node:test";
import assert from "node:assert/strict";
import { SqlAdapter } from "../sql-adapter.js";
import { QueryCompareOp } from "../connector-plan.js";
import { ConnectionFailureKind } from "../connection-reconnect.js";
import { RecordingSqlSession } from "./sql-fakes.js";
import type { ISqlSession, SqlRow } from "../sql-session.js";

test("SqlAdapter.ClassifyFailure delegates to the session's classifier", () =>
{
    const seen: unknown[] = [];
    const session: ISqlSession =
    {
        Query: async (): Promise<readonly SqlRow[]> => [],
        Execute: async (): Promise<number> => 0,
        ClassifyFailure: (error: unknown): ConnectionFailureKind =>
        {
            seen.push(error);
            return ConnectionFailureKind.Auth;
        },
    };
    const err = new Error("x");
    assert.equal(new SqlAdapter(session).ClassifyFailure(err), ConnectionFailureKind.Auth);
    assert.deepEqual(seen, [err]);
});

test("SqlAdapter.ClassifyFailure is Permanent when the session has no classifier", () =>
{
    assert.equal(new SqlAdapter(new RecordingSqlSession()).ClassifyFailure(new Error("x")), ConnectionFailureKind.Permanent);
});

test("QueryPage emits ORDER BY the order key with LIMIT and no After on the first page", async () =>
{
    const session = new RecordingSqlSession([{ id: "k1", name: "a" }, { id: "k2", name: "b" }]);
    const slice = await new SqlAdapter(session).QueryPage({ Source: "t", Fields: ["id", "name"], OrderKey: "id" }, { Limit: 2 });
    assert.equal(session.calls[0]!.sql, "SELECT \"id\", \"name\" FROM \"t\" ORDER BY \"id\" LIMIT 2");
    assert.deepEqual(session.calls[0]!.params, []);
    assert.deepEqual(slice.Records, [{ id: "k1", name: "a" }, { id: "k2", name: "b" }]);
    assert.equal(slice.NextAfter, "k2");
});

test("QueryPage adds a keyset predicate when After is set", async () =>
{
    const session = new RecordingSqlSession([]);
    await new SqlAdapter(session).QueryPage({ Source: "t", Fields: ["id", "name"], OrderKey: "id" }, { After: "k5", Limit: 2 });
    assert.equal(session.calls[0]!.sql, "SELECT \"id\", \"name\" FROM \"t\" WHERE \"id\" > $1 ORDER BY \"id\" LIMIT 2");
    assert.deepEqual(session.calls[0]!.params, ["k5"]);
});

test("QueryPage ANDs Where with the keyset predicate", async () =>
{
    const session = new RecordingSqlSession([]);
    await new SqlAdapter(session).QueryPage(
        {
            Source: "t",
            Fields: ["id"],
            OrderKey: "id",
            Where: { All: [{ Field: "active", Op: QueryCompareOp.Eq, Value: true }] },
        },
        { After: "k5", Limit: 3 });
    assert.equal(session.calls[0]!.sql, "SELECT \"id\" FROM \"t\" WHERE \"active\" = $1 AND \"id\" > $2 ORDER BY \"id\" LIMIT 3");
    assert.deepEqual(session.calls[0]!.params, [true, "k5"]);
});

test("a short slice (fewer than Limit rows) reports NextAfter undefined", async () =>
{
    const session = new RecordingSqlSession([{ id: "k1" }]);
    const slice = await new SqlAdapter(session).QueryPage({ Source: "t", Fields: ["id"] }, { Limit: 2 });
    assert.equal(slice.NextAfter, undefined);
    assert.equal(slice.Records.length, 1);
    assert.ok(session.calls[0]!.sql.includes("ORDER BY \"id\""));
});

test("SqlAdapter.CanPage is true", () =>
{
    assert.equal(new SqlAdapter(new RecordingSqlSession()).CanPage, true);
});

test("QueryPage rejects a non-positive or non-integer Limit", async () =>
{
    const adapter = new SqlAdapter(new RecordingSqlSession());
    await assert.rejects(adapter.QueryPage({ Source: "t", Fields: ["id"] }, { Limit: 0 }), { message: "QueryPage Limit must be a positive integer" });
    await assert.rejects(adapter.QueryPage({ Source: "t", Fields: ["id"] }, { Limit: 1.5 }), { message: "QueryPage Limit must be a positive integer" });
});

test("a null order-key value on a full page yields no NextAfter", async () =>
{
    const session = new RecordingSqlSession([{ id: null }]);
    const slice = await new SqlAdapter(session).QueryPage({ Source: "t", Fields: ["id"] }, { Limit: 1 });
    assert.equal(slice.NextAfter, undefined);
});
