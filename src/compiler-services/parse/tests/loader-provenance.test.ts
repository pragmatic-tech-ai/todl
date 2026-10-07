import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { Severity } from "../../diagnostics/diagnostic.js";

test("every own node of a two-file unit set is homed to its authoring file", () => {
  const a = `namespace demo
  {
    concept alpha { label : string; relationship links -> beta; }
    taxonomy kinds : represents alpha { term first { label = "x"; } term second { label = "y"; } }
    viewpoint vp : frames alpha
  }`;
  const b = `namespace demo
  {
    concept beta { label : string; }
    model m : demo
    {
      beta b1 { label = "B1"; }
    }
  }`;
  const { model, diagnostics, provenance } = check([{ uri: "a.todl", text: a }, { uri: "b.todl", text: b }]);
  assert.deepEqual(diagnostics.filter((d) => d.severity === Severity.Error), []);

  const expected: Record<string, string> = {
    "demo.alpha": "a.todl",
    "demo.alpha.links": "a.todl",
    "demo.kinds": "a.todl",
    "demo.kinds.first": "a.todl",
    "demo.kinds.second": "a.todl",
    "demo.vp": "a.todl",
    "demo.beta": "b.todl",
    "demo.m": "b.todl",
    "demo.b1": "b.todl",
  };
  for (const [id, uri] of Object.entries(expected))
  {
    assert.ok(model.resolve(id) !== undefined, `node ${id} should exist`);
    assert.equal(provenance.get(id), uri, `provenance of ${id}`);
  }
});
