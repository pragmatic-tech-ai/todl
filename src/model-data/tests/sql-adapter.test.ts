import { test } from "node:test";
import assert from "node:assert/strict";
import { SqlAdapter } from "../sql-adapter.js";
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
