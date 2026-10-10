import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { toJSON, fromJSON } from "../json.js";
import { emitModelTodl, deriveBindings } from "../todl.js";


const SOURCES = [
  { uri: "meta.todl", text: `namespace t { concept report { label : string; } }` },
  { uri: "m.todl", text: `namespace m { import t; model clinic : t {
    report monthly { label = "Monthly"; variant "Nobody reads it."; }
    report weekly { label = "Weekly"; }
  } }` },
];

test("variants survive toJSON/fromJSON and are omitted where there are none", () => {
  const { model } = check(SOURCES);
  const json = toJSON(model);
  assert.deepEqual(json.nodes.find((n) => n.id === "m.monthly")!.variants, ["Nobody reads it."]);
  assert.equal("variants" in json.nodes.find((n) => n.id === "m.weekly")!, false);
  assert.deepEqual(fromJSON(json).variantsOf("m.monthly"), ["Nobody reads it."]);
});

test("emitModelTodl writes variants back as variant statements that re-parse", () => {
  const meta = check([SOURCES[0]!]).model;
  const baseIds = new Set(meta.allNodes().map((n) => n.id));
  const { model } = check(SOURCES);
  const all = toJSON(model);
  const own = { nodes: all.nodes.filter((n) => !baseIds.has(n.id) && n.metaKind === null), edges: [] };
  const src = emitModelTodl(own, "m", deriveBindings(model, baseIds, "m", own));
  assert.match(src, /variant "Nobody reads it\.";/);

  const again = check([SOURCES[0]!, { uri: "again.todl", text: src }]);
  assert.deepEqual(again.diagnostics, []);
  assert.deepEqual(again.model.variantsOf("m.monthly"), ["Nobody reads it."]);
});
