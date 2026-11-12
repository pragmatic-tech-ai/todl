import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QueryCompareOp } from "../index.js";
import type { IInstanceFilter, IInstanceView, QueryFilter, QueryComparison, EntityHost } from "../index.js";

class RetiredPolicyExports
{
    public static readonly Names: readonly string[] = ["parsePolicyPredicate", "PolicyPredicateCodec", "PolicyNodeKind", "PolicyPredicateMembers"];
}

describe("query filter barrel exports", () =>
{
    it("exposes value exports from the package root", () =>
    {
        assert.ok(QueryCompareOp.Eq !== undefined);
    });

    it("resolves type exports", () =>
    {
        const types: [IInstanceFilter?, IInstanceView?, QueryFilter?, QueryComparison?, EntityHost?] = [];
        assert.equal(types.length, 0);
    });

    it("no longer exports the retired policy predicate surface", async () =>
    {
        const keys = Object.keys(await import("../index.js"));
        for (const name of RetiredPolicyExports.Names)
        {
            assert.ok(!keys.includes(name), name);
        }
    });
});
