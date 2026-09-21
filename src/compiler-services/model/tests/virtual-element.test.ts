import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MetaKind } from "../kinds.js";
import { check } from "../../api.js";
import { EdgeKind, Direction } from "../graph.js";

describe("SPEC-01 T1: MetaKind.Term", () => {
  test("Term is a first-class language construct", () => {
    assert.equal(MetaKind.Term, "term");
  });
});

describe("SPEC-02: virtual Element root rule", () => {
  test("parent-less concept reaches Element by rule with NO stored Extends edge", () => {
    const { model } = check([{ uri: "a.todl", text: `namespace a { concept Thing { } }` }]);
    assert.ok(model.supertypesOf("Thing").includes("Element"), "Thing reaches Element");
    // The super-node killer: there is no persisted Extends edge Thing -> Element.
    assert.deepEqual(model.related("Thing", EdgeKind.Extends, Direction.Out), []);
  });

  test("explicit parent still resolves transitively (Base via edge, Element via rule)", () => {
    const { model } = check([{ uri: "a.todl", text: `namespace a { concept Base { } concept Sub : Base { } }` }]);
    const sup = model.supertypesOf("Sub");
    assert.ok(sup.includes("Base"));
    assert.ok(sup.includes("Element"));
    assert.deepEqual(model.related("Sub", EdgeKind.Extends, Direction.Out), ["Base"]); // only the explicit edge
  });

  test("Element is the root: no self-loop, empty reverse adjacency (no super-node)", () => {
    const { model } = check([{ uri: "a.todl", text: `namespace a { concept Thing { } concept Other { } }` }]);
    assert.ok(!model.supertypesOf("Element").includes("Element"));
    // Was N (one per concept); now 0 — Element carries no incoming Extends edges.
    assert.deepEqual(model.related("Element", EdgeKind.Extends, Direction.In), []);
  });

  test("schemaOf reports Element as the rule-derived parent of a parent-less concept", () => {
    const { model } = check([{ uri: "a.todl", text: `namespace a { concept Thing { } }` }]);
    assert.equal(model.schemaOf("Thing").extends, "Element");
    assert.equal(model.schemaOf("Element").extends, null); // Element roots at nothing
  });

  test("annotations do NOT get a virtual Element parent (concept-scoped rule)", () => {
    const { model } = check([{ uri: "a.todl", text: `namespace a { annotation Note { } }` }]);
    assert.ok(!model.supertypesOf("Note").includes("Element"));
  });
});
