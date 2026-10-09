import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../../model/model.js";
import { Direction, EdgeKind } from "../../model/graph.js";
import { ResolutionPass } from "../resolution-pass.js";

function seed(): Repository
{
    const model = new Repository();
    const b = model.builder();
    b.setNamespace("n").defineConcept("n.C").addField("n.C", "email", "string");
    b.commit();
    const ib = model.builder();
    ib.setNamespace("n");
    ib.defineIdentity("n.C@identity", "n.C", "email");
    ib.commit();
    return model;
}

function addInstance(model: Repository, id: string, email: string | undefined)
{
    const b = model.builder();
    b.setNamespace("n").assertInstance("n.C", id);
    if (email !== undefined) b.setField(id, "email", email);
    b.commit();
}

test("two instances with the same key collapse to one canonical", () =>
{
    const model = seed();
    addInstance(model, "n.b", "x@y.z");
    addInstance(model, "n.a", "x@y.z");
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);           // lowest id is canonical
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
});

test("different key values are not merged", () =>
{
    const model = seed();
    addInstance(model, "n.a", "a@x.z");
    addInstance(model, "n.b", "b@x.z");
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C").sort(), ["n.a", "n.b"]);
});

test("instances with no key value stay standalone", () =>
{
    const model = seed();
    addInstance(model, "n.a", undefined);
    addInstance(model, "n.b", undefined);
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C").sort(), ["n.a", "n.b"]);
    assert.equal(model.resolve("n.a")!.canonicalId, null);
});

test("three instances sharing a key all collapse to one canonical", () =>
{
    const model = seed();
    addInstance(model, "n.c", "k");
    addInstance(model, "n.a", "k");
    addInstance(model, "n.b", "k");
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
    assert.equal(model.resolve("n.c")!.canonicalId, "n.a");
});

test("canonical is the lowest id regardless of insertion order", () =>
{
    const model = seed();
    addInstance(model, "n.z", "k");
    addInstance(model, "n.a", "k");
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
});

test("the pass is idempotent", () =>
{
    const model = seed();
    addInstance(model, "n.a", "k");
    addInstance(model, "n.b", "k");
    const pass = new ResolutionPass(model);
    pass.Resolve();
    pass.Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
});

test("references to an alias are rebound to the canonical", () =>
{
    const model = seed();
    addInstance(model, "n.a", "k");
    addInstance(model, "n.b", "k");
    const rb = model.builder();
    rb.setNamespace("n").defineConcept("n.Ref").addConceptRelationship("n.Ref", "points", ["n.C"]);
    rb.assertInstance("n.Ref", "n.r").addRelationship("n.r", "points", "n.b");
    rb.commit();

    new ResolutionPass(model).Resolve();

    assert.deepEqual(model.related("n.r", EdgeKind.Relationship, Direction.Out, "points"), ["n.a"]);
});
