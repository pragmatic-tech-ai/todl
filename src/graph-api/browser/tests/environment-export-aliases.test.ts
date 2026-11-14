import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ITenantReadClient, ITenantWriteClient, IEnvironmentReadClient, IEnvironmentWriteClient, TenantNodeCell, EnvironmentNodeCell, TenantFieldCell, EnvironmentFieldCell } from "../../../index.js";

class AliasFx
{
    public static readonly Pairs: readonly (readonly [string, string])[] = [
        ["RemoteTenantConnector", "RemoteEnvironmentConnector"],
        ["TenantDocumentAssembler", "EnvironmentDocumentAssembler"],
    ];
}

describe("environment export aliases", () =>
{
    it("the old export names still resolve to the new classes", async () =>
    {
        const root = await import("../../../index.js") as unknown as Record<string, unknown>;
        for (const [legacy, current] of AliasFx.Pairs)
        {
            assert.ok(root[current] !== undefined, current);
            assert.equal(root[legacy], root[current], legacy);
        }
    });

    it("the old type names are assignable to and from the new ones", () =>
    {
        const read: ITenantReadClient | undefined = undefined as IEnvironmentReadClient | undefined;
        const write: IEnvironmentWriteClient | undefined = undefined as ITenantWriteClient | undefined;
        const node: TenantNodeCell | undefined = undefined as EnvironmentNodeCell | undefined;
        const field: EnvironmentFieldCell | undefined = undefined as TenantFieldCell | undefined;
        assert.deepEqual([read, write, node, field], [undefined, undefined, undefined, undefined]);
    });
});
