import { test } from "node:test";
import assert from "node:assert/strict";
import { SqlQueryTranslator } from "../sql-adapter.js";
import { DataSqlSession, RecordingSqlSession } from "./sql-fakes.js";

test("SqlQueryTranslator emits a quoted SELECT with no params", async () =>
{
    const session = new RecordingSqlSession();
    await new SqlQueryTranslator(session).Query({ Source: "order", Fields: ["order_id", "display_name", "created_at"] });
    assert.equal(session.calls.length, 1);
    assert.equal(session.calls[0]!.sql, 'SELECT "order_id", "display_name", "created_at" FROM "order"');
    assert.deepEqual(session.calls[0]!.params, []);
});

test("SqlQueryTranslator maps rows to external records", async () =>
{
    const session = new DataSqlSession([{ order_id: "O-1007", display_name: "Acme reorder" }]);
    const records = await new SqlQueryTranslator(session).Query({ Source: "order", Fields: ["order_id", "display_name"] });
    assert.deepEqual(records, [{ order_id: "O-1007", display_name: "Acme reorder" }]);
});

test("SqlQueryTranslator coerces undefined to null and other values to strings", async () =>
{
    const when = new Date(0);
    const session = new DataSqlSession([{ a: undefined, b: null, c: 3, d: true, e: when }]);
    const [record] = await new SqlQueryTranslator(session).Query({ Source: "t", Fields: ["a", "b", "c", "d", "e"] });
    assert.deepEqual(record, { a: null, b: null, c: 3, d: true, e: String(when) });
});

test("SqlQueryTranslator doubles embedded quotes in identifiers", async () =>
{
    const session = new RecordingSqlSession();
    await new SqlQueryTranslator(session).Query({ Source: 'we"ird', Fields: ["x"] });
    assert.equal(session.calls[0]!.sql, 'SELECT "x" FROM "we""ird"');
    assert.equal(SqlQueryTranslator.QuoteIdent('we"ird'), '"we""ird"');
});

test("SqlQueryTranslator passes NaN and Infinity through as numbers", async () =>
{
    const session = new DataSqlSession([{ a: NaN, b: Infinity }]);
    const [record] = await new SqlQueryTranslator(session).Query({ Source: "t", Fields: ["a", "b"] });
    assert.deepEqual(record, { a: NaN, b: Infinity });
});
