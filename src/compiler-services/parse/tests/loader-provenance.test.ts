import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";
import { Severity } from "../../diagnostics/diagnostic.js";

const FileA = "a.todl";
const FileB = "b.todl";

const SourceA = `namespace demo
  {
    primitive code { }
    annotation badge { path : string; }
    concept alpha { label : string; relationship links -> beta; annotate badge { path = "a.svg"; } }
    taxonomy kinds : represents alpha { term first { label = "x"; term inner { label = "i"; } } term second { label = "y"; } }
    viewpoint vp : frames alpha
  }`;

const SourceB = `namespace demo
  {
    concept beta { label : string; }
    concept conn { from : beta; to : beta; }
    operator ~> : conn (from, to);
    model m : demo
    {
      beta b1 { label = "B1"; }
    }
  }`;

class ProvenanceFixture
{
  public static Load()
  {
    const result = check([{ uri: FileA, text: SourceA }, { uri: FileB, text: SourceB }]);
    assert.deepEqual(result.diagnostics.filter((d) => d.severity === Severity.Error), []);
    return result;
  }
}

test("every own node of a two-file unit set is homed to its authoring file", () => {
  const { model, provenance } = ProvenanceFixture.Load();
  const expected: Record<string, string> = {
    "demo.alpha": FileA,
    "demo.alpha.links": FileA,
    "demo.kinds": FileA,
    "demo.kinds.first": FileA,
    "demo.kinds.second": FileA,
    "demo.vp": FileA,
    "demo.beta": FileB,
    "demo.m": FileB,
    "demo.b1": FileB,
  };
  for (const [id, uri] of Object.entries(expected))
  {
    assert.ok(model.resolve(id) !== undefined, `node ${id} should exist`);
    assert.equal(provenance.get(id), uri, `provenance of ${id}`);
  }
});

test("primitive, annotation declaration and operator declarations are homed", () => {
  const { model, provenance } = ProvenanceFixture.Load();
  assert.ok(model.resolve("demo.code") !== undefined);
  assert.equal(provenance.get("demo.code"), FileA);
  assert.ok(model.resolve("demo.badge") !== undefined);
  assert.equal(provenance.get("demo.badge"), FileA);
  // defineOperator mints the node under the bare glyph.
  assert.ok(model.resolve("~>") !== undefined);
  assert.equal(provenance.get("~>"), FileB);
});

test("a hierarchy sub-term is homed to its file", () => {
  const { model, provenance } = ProvenanceFixture.Load();
  assert.ok(model.resolve("demo.kinds.inner") !== undefined);
  assert.equal(provenance.get("demo.kinds.inner"), FileA);
});

test("an annotation-application node is homed to the file declaring it", () => {
  const { model, provenance } = ProvenanceFixture.Load();
  const appId = "demo.alpha@demo.badge";
  assert.ok(model.resolve(appId) !== undefined);
  assert.equal(provenance.get(appId), FileA);
});

test("provenance holds only own nodes: every key resolves and no base node is homed", () => {
  const { model, provenance } = ProvenanceFixture.Load();
  for (const [id, uri] of provenance)
  {
    assert.ok(model.resolve(id) !== undefined, `provenance key ${id} should be a real node`);
    assert.ok(uri === FileA || uri === FileB, `${id} homed to unexpected ${uri}`);
  }
});
