import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph, Tier } from "../graph.js";
import { MetaKind } from "../kinds.js";
import { Builder } from "../builder.js";

test("definePolicy stages an Ontology-tier MetaKind.Policy node with concept + rules", () => {
  const g = new Graph();
  const b = new Builder(g);
  b.defineConcept("n.C");
  b.definePolicy("n.C@policy", "n.C", JSON.stringify([{ effect: "allow", action: "read", predicate: { kind: 0 } }]));
  b.commit();
  const node = g.getNode("n.C@policy");
  assert.equal(node!.tier, Tier.Ontology);
  assert.equal(node!.metaKind, MetaKind.Policy);
  assert.equal(node!.attrs.get(Builder.PolicyConceptAttr), "n.C");
  assert.equal(typeof node!.attrs.get(Builder.PolicyRulesAttr), "string");
});
