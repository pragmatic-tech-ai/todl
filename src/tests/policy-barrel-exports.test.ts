import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PolicyPredicateCodec, QueryCompareOp, parsePolicyPredicate, PolicyParseError, PolicyNodeKind, PolicyRefRoot, PolicyBoolOp, PolicyCompareOp, PolicyPredicateMembers } from "../index.js";
import type { IInstanceFilter, IInstanceView, IConnectorQueryFilterProvider, QueryFilter, QueryComparison, PolicyPredicate, EntityHost } from "../index.js";

describe("policy barrel exports", () =>
{
    it("exposes value exports from the package root", () =>
    {
        assert.equal(typeof PolicyPredicateCodec, "function");
        assert.equal(typeof parsePolicyPredicate, "function");
        assert.equal(typeof PolicyParseError, "function");
        assert.equal(typeof PolicyPredicateMembers, "function");
        assert.ok(QueryCompareOp.Eq !== undefined);
        assert.ok(PolicyNodeKind.Ref !== undefined);
        assert.ok(PolicyRefRoot.Principal !== undefined);
        assert.ok(PolicyBoolOp.And !== undefined);
        assert.ok(PolicyCompareOp.Eq !== undefined);
    });

    it("resolves type exports", () =>
    {
        const types: [IInstanceFilter?, IInstanceView?, IConnectorQueryFilterProvider?, QueryFilter?, QueryComparison?, PolicyPredicate?, EntityHost?] = [];
        assert.equal(types.length, 0);
    });
});
