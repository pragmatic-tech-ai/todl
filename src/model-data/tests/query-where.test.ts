import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryCompareOp } from "../connector-plan.js";
import type { QueryRequest } from "../connector-plan.js";
import { InMemoryAdapter } from "./fakes.js";
import { SqlQueryTranslator } from "../sql-adapter.js";
import { RecordingSqlSession } from "./sql-fakes.js";

test("InMemoryAdapter honors a Where conjunction", async () =>
{
    const adapter = new InMemoryAdapter();
    adapter.Seed("customers", [{ id: "1", region: "eu" }, { id: "2", region: "us" }]);
    const request: QueryRequest = { Source: "customers", Fields: ["id", "region"], Where: { All: [{ Field: "region", Op: QueryCompareOp.Eq, Value: "eu" }] } };
    const rows = await adapter.Query(request);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, "1");
});

test("InMemoryAdapter honors Neq", async () =>
{
    const adapter = new InMemoryAdapter();
    adapter.Seed("customers", [{ id: "1", region: "eu" }, { id: "2", region: "us" }]);
    const rows = await adapter.Query({ Source: "customers", Fields: ["id"], Where: { All: [{ Field: "region", Op: QueryCompareOp.Neq, Value: "eu" }] } });
    assert.deepEqual(rows.map(r => r.id), ["2"]);
});

test("SqlQueryTranslator emits a parameter-bound WHERE", async () =>
{
    const session = new RecordingSqlSession();
    const translator = new SqlQueryTranslator(session);
    const request: QueryRequest = { Source: "customers", Fields: ["id", "region"], Where: { All: [{ Field: "region", Op: QueryCompareOp.Eq, Value: "eu" }] } };
    await translator.Query(request);
    const call = session.calls[0]!;
    assert.match(call.sql, /WHERE "region" = \$1/);
    assert.deepEqual(call.params, ["eu"]);
    assert.ok(!call.sql.includes("eu"));
});

test("SqlQueryTranslator numbers multiple comparisons and omits WHERE when absent", async () =>
{
    const session = new RecordingSqlSession();
    const translator = new SqlQueryTranslator(session);
    await translator.Query({ Source: "t", Fields: ["a"], Where: { All: [
        { Field: "a", Op: QueryCompareOp.Eq, Value: "x" },
        { Field: "b", Op: QueryCompareOp.Neq, Value: 2 }] } });
    await translator.Query({ Source: "t", Fields: ["a"] });
    assert.equal(session.calls[0]!.sql, 'SELECT "a" FROM "t" WHERE "a" = $1 AND "b" <> $2');
    assert.deepEqual(session.calls[0]!.params, ["x", 2]);
    assert.equal(session.calls[1]!.sql, 'SELECT "a" FROM "t"');
    assert.deepEqual(session.calls[1]!.params, []);
});
