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
    assert.equal(model.resolve("n.b")!.canonicalId, null);
});

test("empty-string key values are real values and merge", () =>
{
    const model = seed();
    addInstance(model, "n.b", "");
    addInstance(model, "n.a", "");
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
});

function seedStorageKey(): Repository
{
    const model = new Repository();
    const b = model.builder();
    b.setNamespace("n").defineConcept("n.C");
    b.commit();
    const ib = model.builder();
    ib.setNamespace("n");
    ib.defineIdentity("n.C@identity", "n.C", "storageId");
    ib.commit();
    return model;
}

function addPlain(model: Repository, id: string, storageId: string | null)
{
    const b = model.builder();
    b.setNamespace("n").assertInstance("n.C", id);
    b.commit();
    model.resolve(id)!.storageId = storageId;
}

test("the reserved storageId key merges instances with the same stamped storageId", () =>
{
    const model = seedStorageKey();
    addPlain(model, "n.b", "s1");
    addPlain(model, "n.a", "s1");
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
});

test("the storageId key does not merge unstamped instances", () =>
{
    const model = seedStorageKey();
    addPlain(model, "n.a", null);
    addPlain(model, "n.b", null);
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C").sort(), ["n.a", "n.b"]);
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

function seedWithMatch(rules: string[][]): Repository
{
    const model = new Repository();
    const b = model.builder();
    b.setNamespace("n").defineConcept("n.C").addField("n.C", "email", "string")
        .addField("n.C", "tax", "string").addField("n.C", "country", "string");
    b.commit();
    const mb = model.builder();
    mb.setNamespace("n");
    mb.defineMatch("n.C@match", "n.C", JSON.stringify(rules));
    mb.commit();
    return model;
}

function addRow(model: Repository, id: string, fields: Record<string, string | undefined>)
{
    const b = model.builder();
    b.setNamespace("n").assertInstance("n.C", id);
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) b.setField(id, k, v);
    b.commit();
}

test("two instances matching a rule collapse even with no identity key", () =>
{
    const model = seedWithMatch([["email"]]);
    addRow(model, "n.b", { email: "x@y.z" });
    addRow(model, "n.a", { email: "x@y.z" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
});

test("match rules cluster transitively via union-find", () =>
{
    const model = seedWithMatch([["email"], ["tax"]]);
    addRow(model, "n.a", { email: "same@x.z", tax: "T1" });
    addRow(model, "n.b", { email: "same@x.z", tax: "T2" });
    addRow(model, "n.c", { email: "other@x.z", tax: "T2" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
    assert.equal(model.resolve("n.c")!.canonicalId, "n.a");
});

test("a rule field undefined on one side does not merge", () =>
{
    const model = seedWithMatch([["tax", "country"]]);
    addRow(model, "n.a", { tax: "T", country: "US" });
    addRow(model, "n.b", { tax: "T" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C").sort(), ["n.a", "n.b"]);
});

test("a multi-field rule requires ALL fields to agree", () =>
{
    const model = seedWithMatch([["tax", "country"]]);
    addRow(model, "n.a", { tax: "T", country: "US" });
    addRow(model, "n.b", { tax: "T", country: "CA" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C").sort(), ["n.a", "n.b"]);
});
