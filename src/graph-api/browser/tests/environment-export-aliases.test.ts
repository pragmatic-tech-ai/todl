import { describe, it } from "node:test";
import assert from "node:assert/strict";

class AliasFx
{
    public static readonly PreRenameNames: readonly string[] = ["RemoteTenantConnector", "TenantDocumentAssembler"];
    public static readonly CurrentNames: readonly string[] = ["RemoteEnvironmentConnector", "EnvironmentDocumentAssembler"];
}

describe("environment export names", () =>
{
    it("exports the environment names and no longer the pre-rename tenant names", async () =>
    {
        const root = await import("../../../index.js") as unknown as Record<string, unknown>;
        for (const current of AliasFx.CurrentNames)
        {
            assert.ok(root[current] !== undefined, current);
        }
        for (const old of AliasFx.PreRenameNames)
        {
            assert.equal(root[old], undefined, old);
        }
    });
});
