import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../model.js";
import { EdgeKind, Direction } from "../graph.js";

class RepositoryMutatorFixture
{
    public static Seeded(): Repository
    {
        const model = new Repository();
        const b = model.builder();
        b.setNamespace("n").defineConcept("n.C").addField("n.C", "label", "string");
        b.assertInstance("n.C", "n.a").defineConcept("n.D").assertInstance("n.D", "n.b");
        b.commit();
        return model;
    }
}

test("setAttr writes a scalar onto an existing node", () =>
{
    const model = RepositoryMutatorFixture.Seeded();
    model.setAttr("n.a", "label", "hello");
    assert.equal(model.resolve("n.a")!.attrs.get("label"), "hello");
});

test("addEdge adds a relationship edge", () =>
{
    const model = RepositoryMutatorFixture.Seeded();
    model.addEdge({ kind: EdgeKind.Relationship, via: "rel", from: "n.a", to: "n.b" });
    assert.deepEqual(model.related("n.a", EdgeKind.Relationship, Direction.Out, "rel"), ["n.b"]);
});
