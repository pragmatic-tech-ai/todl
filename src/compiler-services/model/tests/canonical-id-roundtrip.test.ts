import { test } from "node:test";
import assert from "node:assert/strict";

import { EdgeKind } from "../graph.js";
import { toJSON, fromJSON } from "../../emit/json.js";
import { Repository } from "../model.js";

test("SameAs is a distinct EdgeKind", () =>
{
    assert.equal(typeof EdgeKind.SameAs, "number");
    assert.notEqual(EdgeKind.SameAs, EdgeKind.Relationship);
});

test("canonicalId round-trips through JSON", () =>
{
    const model = new Repository();
    const b = model.builder();
    b.setNamespace("n").defineConcept("n.C").assertInstance("n.C", "n.a").commit();
    const node = model.resolve("n.a")!;
    node.canonicalId = "n.canon";

    const recomposed = fromJSON(toJSON(model));
    assert.equal(recomposed.resolve("n.a")!.canonicalId, "n.canon");
});

test("canonicalId defaults to null on a freshly built node", () =>
{
    const model = new Repository();
    model.builder().setNamespace("n").defineConcept("n.C").assertInstance("n.C", "n.a").commit();
    assert.equal(model.resolve("n.a")!.canonicalId, null);
});
