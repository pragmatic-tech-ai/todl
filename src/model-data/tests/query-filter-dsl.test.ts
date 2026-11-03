import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { QueryCompareOp, type QueryComparison, type QueryFilter } from "../connector-plan.js";
import { QueryFilterEvaluator } from "../query-filter-evaluator.js";
import { QueryFilterTranslator, UnmappedFilterFieldError } from "../query-filter-translator.js";
import { SqlQueryTranslator } from "../sql-adapter.js";
import { RecordingSqlSession } from "./sql-fakes.js";
import { WriteAtomicity, WriteConcurrency, type ConnectorBinding } from "../connector-plan.js";

class DslFixture
{
    public static Term(Field: string, Op: QueryCompareOp, Value: QueryComparison["Value"] = null, Values?: QueryComparison["Value"][]): QueryComparison
    {
        return Values === undefined ? { Field, Op, Value } : { Field, Op, Value, Values };
    }

    public static Keeps(record: Record<string, unknown>, ...terms: QueryComparison[]): boolean
    {
        return QueryFilterEvaluator.Matches(record, { All: terms });
    }
}

describe("QueryFilterEvaluator", () =>
{
    test("ranges compare like with like; mixed types never match", () =>
    {
        const row = { n: 5, s: "m" };
        assert.equal(DslFixture.Keeps(row, DslFixture.Term("n", QueryCompareOp.Gt, 4), DslFixture.Term("n", QueryCompareOp.Lte, 5)), true);
        assert.equal(DslFixture.Keeps(row, DslFixture.Term("n", QueryCompareOp.Lt, 5)), false);
        assert.equal(DslFixture.Keeps(row, DslFixture.Term("s", QueryCompareOp.Gte, "a"), DslFixture.Term("s", QueryCompareOp.Lt, "z")), true);
        assert.equal(DslFixture.Keeps(row, DslFixture.Term("n", QueryCompareOp.Gt, "4")), false);
    });

    test("IN matches a member of the set; an empty set matches nothing", () =>
    {
        assert.equal(DslFixture.Keeps({ r: "eu" }, DslFixture.Term("r", QueryCompareOp.In, null, ["us", "eu"])), true);
        assert.equal(DslFixture.Keeps({ r: "apac" }, DslFixture.Term("r", QueryCompareOp.In, null, ["us", "eu"])), false);
        assert.equal(DslFixture.Keeps({ r: "eu" }, DslFixture.Term("r", QueryCompareOp.In, null, [])), false);
    });

    test("SQL NULL semantics: a null or missing field satisfies only IS NULL", () =>
    {
        for (const row of [{ r: null }, {}])
        {
            assert.equal(DslFixture.Keeps(row, DslFixture.Term("r", QueryCompareOp.IsNull)), true);
            assert.equal(DslFixture.Keeps(row, DslFixture.Term("r", QueryCompareOp.IsNotNull)), false);
            for (const op of [QueryCompareOp.Eq, QueryCompareOp.Neq, QueryCompareOp.Lt, QueryCompareOp.Gte])
            {
                assert.equal(DslFixture.Keeps(row, DslFixture.Term("r", op, "x")), false, op);
            }
            assert.equal(DslFixture.Keeps(row, DslFixture.Term("r", QueryCompareOp.In, null, [null])), false);
        }
        assert.equal(DslFixture.Keeps({ r: "x" }, DslFixture.Term("r", QueryCompareOp.IsNotNull)), true);
    });
});

describe("SqlQueryTranslator rich filters", () =>
{
    test("ranges, IN and NULL tests translate to parameterized SQL", async () =>
    {
        const session = new RecordingSqlSession();
        const where: QueryFilter = { All: [
            DslFixture.Term("n", QueryCompareOp.Gte, 1),
            DslFixture.Term("n", QueryCompareOp.Lt, 9),
            DslFixture.Term("r", QueryCompareOp.In, null, ["eu", "us"]),
            DslFixture.Term("d", QueryCompareOp.IsNull),
            DslFixture.Term("e", QueryCompareOp.IsNotNull),
        ] };
        await new SqlQueryTranslator(session).Query({ Source: "t", Fields: ["n"], Where: where });
        assert.equal(session.calls[0]!.sql, 'SELECT "n" FROM "t" WHERE "n" >= $1 AND "n" < $2 AND "r" IN ($3, $4) AND "d" IS NULL AND "e" IS NOT NULL');
        assert.deepEqual(session.calls[0]!.params, [1, 9, "eu", "us"]);
    });

    test("an empty IN is a false predicate, and paged reads share the translation", async () =>
    {
        const session = new RecordingSqlSession();
        const where: QueryFilter = { All: [DslFixture.Term("r", QueryCompareOp.In, null, []), DslFixture.Term("n", QueryCompareOp.Gt, 2)] };
        await new SqlQueryTranslator(session).QueryPage({ Source: "t", Fields: ["id", "n"], Where: where, OrderKey: "id" }, { Limit: 10, After: "a" });
        assert.equal(session.calls[0]!.sql, 'SELECT "id", "n" FROM "t" WHERE 1 = 0 AND "n" > $1 AND "id" > $2 ORDER BY "id" LIMIT 10');
        assert.deepEqual(session.calls[0]!.params, [2, "a"]);
    });
});

describe("QueryFilterTranslator.Strict", () =>
{
    const binding: ConnectorBinding = { Concept: "a.C", Connector: "pg", Source: "t", IdKey: "cid", FieldMap: { id: "cid", region: "REGION" }, Writable: false, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential };

    test("maps every term (the id member to the id column) and keeps IN sets", () =>
    {
        const out = QueryFilterTranslator.Strict(binding, { All: [DslFixture.Term("id", QueryCompareOp.Eq, "C1"), DslFixture.Term("region", QueryCompareOp.In, null, ["eu"])] });
        assert.deepEqual(out, { All: [{ Field: "cid", Op: QueryCompareOp.Eq, Value: "C1" }, { Field: "REGION", Op: QueryCompareOp.In, Value: null, Values: ["eu"] }] });
    });

    test("an unmapped member is refused, never silently dropped", () =>
    {
        assert.throws(() => QueryFilterTranslator.Strict(binding, { All: [DslFixture.Term("nope", QueryCompareOp.Eq, "x")] }), UnmappedFilterFieldError);
    });
});
