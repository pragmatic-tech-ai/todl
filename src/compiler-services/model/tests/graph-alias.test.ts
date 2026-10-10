import { test } from "node:test";
import assert from "node:assert/strict";

import { EdgeKind, Direction, Graph } from "../graph.js";
import { Repository } from "../model.js";

function build(): Repository
{
    const model = new Repository();
    const b = model.builder();
    b.setNamespace("n").defineConcept("n.C").defineConcept("n.Ref");
    b.assertInstance("n.C", "n.canon");
    b.assertInstance("n.C", "n.dupe");
    b.assertInstance("n.Ref", "n.r");
    b.addRelationship("n.r", "points", "n.dupe");   // incoming edge to the alias
    b.commit();
    return model;
}

test("alias sets canonicalId and adds a SameAs edge", () =>
{
    const model = build();
    model.alias("n.dupe", "n.canon");
    assert.equal(model.resolve("n.dupe")!.canonicalId, "n.canon");
    assert.deepEqual(model.related("n.dupe", EdgeKind.SameAs, Direction.Out), ["n.canon"]);
});

test("alias redirects incoming references to the canonical", () =>
{
    const model = build();
    model.alias("n.dupe", "n.canon");
    assert.deepEqual(model.related("n.r", EdgeKind.Relationship, Direction.Out, "points"), ["n.canon"]);
});

test("instancesOf excludes aliased nodes", () =>
{
    const model = build();
    model.alias("n.dupe", "n.canon");
    assert.deepEqual(model.instancesOf("n.C"), ["n.canon"]);
});

test("alias is idempotent — no duplicate SameAs edge", () =>
{
    const model = build();
    model.alias("n.dupe", "n.canon");
    model.alias("n.dupe", "n.canon");
    assert.deepEqual(model.related("n.dupe", EdgeKind.SameAs, Direction.Out), ["n.canon"]);
});

test("self-alias and missing nodes are no-ops", () =>
{
    const model = build();
    model.alias("n.dupe", "n.dupe");
    model.alias("n.ghost", "n.canon");
    model.alias("n.dupe", "n.ghost");
    assert.equal(model.resolve("n.dupe")!.canonicalId, null);
    assert.deepEqual(model.related("n.dupe", EdgeKind.SameAs, Direction.Out), []);
});

test("alias does not create a self-loop or duplicate edge on the canonical", () =>
{
    const model = new Repository();
    const b = model.builder();
    b.setNamespace("n").defineConcept("n.C");
    b.assertInstance("n.C", "n.canon");
    b.assertInstance("n.C", "n.dupe");
    b.addRelationship("n.canon", "points", "n.dupe");   // would become a self-loop
    b.addRelationship("n.dupe", "points", "n.canon");
    b.commit();
    model.alias("n.dupe", "n.canon");
    assert.deepEqual(model.related("n.canon", EdgeKind.Relationship, Direction.Out, "points"), []);
});

test("alias never redirects an inbound SameAs marker edge", () =>
{
    const graph = new Graph();
    const model = new Repository(graph);
    const b = model.builder();
    b.setNamespace("n").defineConcept("n.C");
    b.assertInstance("n.C", "n.canon");
    b.assertInstance("n.C", "n.dupe");
    b.assertInstance("n.C", "n.x");
    b.commit();
    graph.addEdge({ kind: EdgeKind.SameAs, via: null, from: "n.x", to: "n.dupe" });
    model.alias("n.dupe", "n.canon");
    assert.ok(model.related("n.dupe", EdgeKind.SameAs, Direction.In).includes("n.x"));
    assert.deepEqual(model.related("n.canon", EdgeKind.SameAs, Direction.In).filter((i) => i === "n.x"), []);
});

test("alias does not duplicate a reference that already targets the canonical", () =>
{
    const model = new Repository();
    const b = model.builder();
    b.setNamespace("n").defineConcept("n.C").defineConcept("n.Ref");
    b.assertInstance("n.C", "n.canon");
    b.assertInstance("n.C", "n.dupe");
    b.assertInstance("n.Ref", "n.r");
    b.addRelationship("n.r", "points", "n.dupe");
    b.addRelationship("n.r", "points", "n.canon");
    b.commit();
    model.alias("n.dupe", "n.canon");
    assert.deepEqual(model.related("n.r", EdgeKind.Relationship, Direction.Out, "points"), ["n.canon"]);
});
