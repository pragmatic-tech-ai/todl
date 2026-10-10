import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../model.js";
import { EdgeKind } from "../graph.js";
import { ResolutionPass } from "../../resolution/resolution-pass.js";

class ReferrersFixture
{
    // Two Customer instances share an identity key (email) -> n.c aliases to n.a.
    // Both point at target n.t via a Relationship edge "buys".
    static resolved(): Repository
    {
        const model = new Repository();
        const b = model.builder();
        b.setNamespace("n").defineConcept("n.Customer").addField("n.Customer", "email", "string");
        b.defineConcept("n.Order");
        b.commit();
        const ib = model.builder();
        ib.setNamespace("n");
        ib.defineIdentity("n.Customer@identity", "n.Customer", "email");
        ib.commit();
        const ab = model.builder();
        ab.setNamespace("n");
        ab.assertInstance("n.Customer", "n.a").setField("n.a", "email", "x@y.z");
        ab.assertInstance("n.Customer", "n.c").setField("n.c", "email", "x@y.z");
        ab.assertInstance("n.Order", "n.t");
        ab.commit();
        model.addEdge({ kind: EdgeKind.Relationship, via: "buys", from: "n.a", to: "n.t" });
        model.addEdge({ kind: EdgeKind.Relationship, via: "buys", from: "n.c", to: "n.t" });
        new ResolutionPass(model).Resolve();
        return model;
    }
}

test("referrers of a target returns the canonical, not the merged-away alias", () =>
{
    const model = ReferrersFixture.resolved();
    const refs = model.referrers("n.t");
    assert.ok(refs.includes("n.a"), "canonical must be a referrer");
    assert.ok(!refs.includes("n.c"), "merged-away alias must not leak as a referrer");
});

test("member-filtered referrers also returns the canonical, not the alias", () =>
{
    const model = ReferrersFixture.resolved();
    const refs = model.referrers("n.t", "buys");
    assert.ok(refs.includes("n.a"), "canonical must be a member-filtered referrer");
    assert.ok(!refs.includes("n.c"), "merged-away alias must not leak via member filter");
});
