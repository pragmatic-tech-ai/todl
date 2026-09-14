import { test } from "node:test";
import assert from "node:assert/strict";
import { TodlGraphModel, GraphTier } from "../todl-graph-model.js";

function sampleDoc(): unknown {
  return {
    nodes: [
      { id: "#c0", tier: "Ontology", typeOf: "concept", attrs: { name: "Person" } },
      { id: "#f0", tier: "Ontology", typeOf: "field", attrs: { name: "age", type: "number" } },
      { id: "#i0", tier: "Instance", typeOf: "#c0", attrs: { id: "alice", name: "Alice" } },
      { id: "#i1", tier: "Instance", typeOf: "#c0", attrs: {} },
      { id: "#m0", tier: "Meta", typeOf: "annotation", attrs: { name: "iconSource" } },
    ],
    edges: [
      { kind: "HasField", via: null, from: "#c0", to: "#f0" },
      { kind: "Relationship", via: "friends", from: "#i0", to: "#i1" },
      { kind: "Annotated", via: null, from: "#c0", to: "#m0" },
    ],
  };
}

test("unwraps the { diagnostics, document } wrapper", () => {
  const m = new TodlGraphModel(JSON.stringify({ diagnostics: [], document: sampleDoc() }));
  assert.equal(m.Nodes.length, 5);
  assert.equal(m.Edges.length, 3);
});

test("accepts a bare { nodes, edges } document", () => {
  assert.equal(new TodlGraphModel(JSON.stringify(sampleDoc())).Nodes.length, 5);
});

test("labels a node by name attr, falling back to id", () => {
  const m = new TodlGraphModel(JSON.stringify(sampleDoc()));
  assert.equal(m.Nodes.find((n) => n.id === "#i0")?.label, "Alice");
  assert.equal(m.Nodes.find((n) => n.id === "#i1")?.label, "#i1");
});

test("resolves typeOf subtitle to the type node name, else raw id", () => {
  const m = new TodlGraphModel(JSON.stringify(sampleDoc()));
  assert.equal(m.Nodes.find((n) => n.id === "#i0")?.subtitle, "Person");
  assert.equal(m.Nodes.find((n) => n.id === "#c0")?.subtitle, "concept");
});

test("maps tier strings to GraphTier", () => {
  const m = new TodlGraphModel(JSON.stringify(sampleDoc()));
  assert.equal(m.Nodes.find((n) => n.id === "#c0")?.tier, GraphTier.Ontology);
  assert.equal(m.Nodes.find((n) => n.id === "#i0")?.tier, GraphTier.Instance);
  assert.equal(m.Nodes.find((n) => n.id === "#m0")?.tier, GraphTier.Meta);
});

test("labels an edge by kind, appending via when set", () => {
  const m = new TodlGraphModel(JSON.stringify(sampleDoc()));
  assert.equal(m.Edges.find((e) => e.from === "#c0" && e.to === "#f0")?.label, "HasField");
  assert.equal(m.Edges.find((e) => e.from === "#i0")?.label, "Relationship: friends");
});

test("reports tiers in canonical order and distinct edge kinds sorted", () => {
  const m = new TodlGraphModel(JSON.stringify(sampleDoc()));
  assert.deepEqual(m.Tiers(), [GraphTier.Meta, GraphTier.Ontology, GraphTier.Instance]);
  assert.deepEqual(m.EdgeKinds(), ["Annotated", "HasField", "Relationship"]);
});

test("slices to admitted tiers and drops edges whose endpoints were filtered out", () => {
  const m = new TodlGraphModel(JSON.stringify(sampleDoc()));
  const slice = m.Slice(new Set([GraphTier.Instance]));
  assert.deepEqual(slice.nodes.map((n) => n.id).sort(), ["#i0", "#i1"]);
  assert.equal(slice.edges.length, 1);
  assert.equal(slice.edges[0]?.kind, "Relationship");
});

test("degrades a non-graph document to empty", () => {
  const m = new TodlGraphModel(JSON.stringify({ foo: "bar" }));
  assert.equal(m.Nodes.length, 0);
  assert.equal(m.Edges.length, 0);
});
