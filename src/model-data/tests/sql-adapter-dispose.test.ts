import { test } from "node:test";
import assert from "node:assert/strict";
import { SqlAdapter } from "../sql-adapter.js";
import { RecordingSqlSession } from "./sql-fakes.js";
import type { ISqlSession, SqlRow } from "../sql-session.js";

test("SqlAdapter.Dispose forwards to a session that implements Dispose", async () =>
{
    let disposed = 0;
    const session: ISqlSession =
    {
        Query: async (): Promise<readonly SqlRow[]> => [],
        Execute: async (): Promise<number> => 0,
        Dispose: async () => { disposed++; },
    };
    await new SqlAdapter(session).Dispose();
    assert.equal(disposed, 1);
});

test("SqlAdapter.Dispose is a no-op when the session omits Dispose", async () =>
{
    // RecordingSqlSession has no Dispose; this must not throw.
    await assert.doesNotReject(() => new SqlAdapter(new RecordingSqlSession()).Dispose());
});
