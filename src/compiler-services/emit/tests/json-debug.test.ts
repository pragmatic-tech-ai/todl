import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../../api.js";
import { toJSON } from "../json.js";
import { FakeIdGenerator } from "../../model/tests/fake-id-generator.js";

const SRC = `namespace app {
  concept Component { label : string; }
  model M : app { Component c { label = "x"; } }
}`;

function compile()
{
  const { model, diagnostics, provenance } = check(
    [{ uri: "app.todl", text: SRC }],
    new FakeIdGenerator(),
  );
  assert.deepEqual(diagnostics.map((d) => d.message), [], "sample compiles clean");
  return { model, provenance };
}

test("debug off (default): nodes/edges carry no debug block — wire form unchanged", () => {
  const { model } = compile();
  const doc = toJSON(model);
  assert.ok(doc.nodes.every((n) => n.debug === undefined), "no node.debug");
  assert.ok(doc.edges.every((e) => e.debug === undefined), "no edge.debug");
});

test("debug on: concept/model/instance carry readable kind + name + type + namespace", () => {
  const { model } = compile();
  const doc = toJSON(model, { debug: true });
  const byId = (id: string) => doc.nodes.find((n) => n.id === id);

  assert.deepEqual(byId("app.Component")?.debug, {
    kind: "concept", name: "app.Component", type: "concept", namespace: "app",
  });
  // `label` is a declared field carried on the Component node (SPEC-01 #4), not a
  // separate `Component.label` member node.
  assert.equal(byId("app.Component.label"), undefined);
  assert.deepEqual(model.resolve("app.Component")!.fields, [
    { name: "label", type: "string", cardinality: 0 },
  ]);
  assert.deepEqual(byId("app.M")?.debug, {
    kind: "model", name: "app.M", type: "model", namespace: "app",
  });
  // The interesting one: an instance names the concept it instantiates.
  assert.deepEqual(byId("app.c")?.debug, {
    kind: "instance", name: "app.c", type: "app.Component", namespace: "app",
  });
});

test("debug on: edges carry readable from/to (behind the opaque endpoint ids)", () => {
  const { model } = compile();
  const doc = toJSON(model, { debug: true });
  const contains = doc.edges.find((e) => e.kind === "Contains" && e.from === "app.M");
  assert.deepEqual(contains?.debug, { from: "app.M", to: "app.c" });
  // No `HasField` edge exists — scalar field schema lives on the concept node now.
  assert.equal(doc.edges.some((e) => e.kind === "HasField"), false);
});

test("debug on with provenance: node.debug.source is the origin uri", () => {
  const { model, provenance } = compile();
  const doc = toJSON(model, { debug: true, provenance });
  // Instances/models are homed in provenance; concepts may not be.
  const m = doc.nodes.find((n) => n.id === "app.M");
  assert.equal(m?.debug?.source, "app.todl");
});
