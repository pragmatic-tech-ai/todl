import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CardinalityGlyph, ManifestModel, type LogicalManifest } from "../logical.js";
import { Cardinality } from "../enums.js";

describe("CardinalityGlyph (SPEC-03 §logical) — enum ↔ wire glyph", () => {
  test("round-trips all four cardinalities", () => {
    for (const c of [Cardinality.One, Cardinality.Optional, Cardinality.Many, Cardinality.OneOrMore]) {
      assert.equal(CardinalityGlyph.fromGlyph(CardinalityGlyph.toGlyph(c)), c);
    }
  });

  test("glyph mapping matches the JOURNAL contract", () => {
    assert.equal(CardinalityGlyph.toGlyph(Cardinality.One), "1");
    assert.equal(CardinalityGlyph.toGlyph(Cardinality.Optional), "?");
    assert.equal(CardinalityGlyph.toGlyph(Cardinality.Many), "*");
    assert.equal(CardinalityGlyph.toGlyph(Cardinality.OneOrMore), "+");
  });
});

// A hand-built manifest: Element <- Component <- Surface; Component declares
// name + color, Surface overrides color; class Components.Surface fixes color.
function fixture(): ManifestModel {
  const data: LogicalManifest = {
    format: "todl-manifest/1",
    model: "shop",
    version: "1.0.0",
    root: "Element",
    concepts: {
      Element: { extends: null, fields: {}, relationships: {}, invariants: [] },
      Component: {
        extends: "Element",
        fields: { name: { type: "string", card: "1" }, color: { type: "string", card: "?" } },
        relationships: {},
        invariants: [],
      },
      Surface: {
        extends: "Component",
        fields: { color: { type: "string", card: "1" } },
        relationships: {},
        invariants: [],
      },
    },
    classes: {
      "Components.Surface": { concept: "Surface", narrower: [], fixed: { color: "red" } },
    },
    taxonomies: {},
  };
  return ManifestModel.fromJSON(data);
}

describe("ManifestModel.typeOriginOf (SPEC-03 Axis 1 — subtype wins)", () => {
  test("inherited field resolves to the declaring supertype", () => {
    assert.equal(fixture().typeOriginOf("Surface", "name"), "Component");
  });

  test("field declared on the subtype resolves to the subtype (override wins)", () => {
    assert.equal(fixture().typeOriginOf("Surface", "color"), "Surface");
  });

  test("field on the concept itself resolves to that concept", () => {
    assert.equal(fixture().typeOriginOf("Component", "name"), "Component");
  });

  test("unknown field resolves to undefined", () => {
    assert.equal(fixture().typeOriginOf("Surface", "nope"), undefined);
  });

  test("ancestorsViaExtends walks to Element and stops", () => {
    assert.deepEqual(fixture().ancestorsViaExtends("Surface"), ["Component", "Element"]);
  });
});

describe("ManifestModel.valueOriginOf (SPEC-03 Axis 2 — self vs class)", () => {
  test("value matching the class fixed value is attributed to the class", () => {
    const node = { class: "Components.Surface", attrs: { color: "red" } };
    assert.equal(fixture().valueOriginOf(node, "color"), "Components.Surface");
  });

  test("value differing from the class fixed value is the instance's own", () => {
    const node = { class: "Components.Surface", attrs: { color: "blue" } };
    assert.equal(fixture().valueOriginOf(node, "color"), "self");
  });

  test("a field the class does not fix is the instance's own", () => {
    const node = { class: "Components.Surface", attrs: { name: "Header" } };
    assert.equal(fixture().valueOriginOf(node, "name"), "self");
  });

  test("a node with no class is always its own origin", () => {
    const node = { class: null, attrs: { color: "red" } };
    assert.equal(fixture().valueOriginOf(node, "color"), "self");
  });
});
