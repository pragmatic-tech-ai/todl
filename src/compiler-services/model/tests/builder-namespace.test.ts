import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph, Tier } from "../graph.js";
import { MetaKind } from "../kinds.js";
import { Builder } from "../builder.js";

test("assertModel stages an Instance-tier node typed by MetaKind.Model", () => {
  const graph = new Graph();
  new Builder(graph).assertModel("prod").commit();
  const node = graph.getNode("prod");
  assert.ok(node);
  assert.equal(node!.tier, Tier.Instance);
  assert.equal(node!.metaKind, MetaKind.Model);
});

test("setNamespace stamps a namespace attr on every staged node", () => {
  const graph = new Graph();
  new Builder(graph).setNamespace("acme").defineConcept("thing").assertInstance("thing", "t1").commit();
  assert.equal(graph.getNode("thing")!.namespace, "acme");
  assert.equal(graph.getNode("t1")!.namespace, "acme");
});

test("addField carries the field schema on the concept node (no member node)", () => {
  const graph = new Graph();
  const b = new Builder(graph).setNamespace("acme").defineConcept("thing");
  b.addField("thing", "label", "string");
  b.commit();
  // SPEC-01 #4: field schema lives on the owner; there is no `thing.label` node.
  assert.equal(graph.getNode("thing.label"), undefined);
  assert.deepEqual(graph.getNode("thing")!.fields, [{ name: "label", type: "string", cardinality: 0 }]);
});
