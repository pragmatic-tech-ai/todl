import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ManifestWriter } from "../manifest-writer.js";
import { ManifestReader } from "../manifest-reader.js";
import { ManifestValidator } from "../manifest-validator.js";
import { TableId, MetaKind, Cardinality } from "../enums.js";
import type { LogicalManifest } from "../logical.js";

// The SPEC-03 strawman, hand-built: Element <- Component <- Surface; Component
// declares name(string,1) + color(string,?) + dependsOn->Component(*, inverse
// usedBy); Surface overrides color to (string,1). Class Components.Surface
// (concept Surface) in taxonomy ComponentKinds fixes color="red".
function logical(): LogicalManifest
{
  return {
    format: "todl-manifest/1",
    model: "shop",
    version: "1.0.0",
    root: "Element",
    concepts: {
      Element: { extends: null, fields: {}, relationships: {}, invariants: [] },
      Component: {
        extends: "Element",
        fields: { name: { type: "string", card: "1" }, color: { type: "string", card: "?" } },
        relationships: { dependsOn: { targets: ["Component"], card: "*", inverse: "usedBy" } },
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
      "Components.Surface": {
        concept: "Surface", taxonomy: "ComponentKinds", narrower: [], fixed: { color: "red" },
      },
    },
    taxonomies: {
      ComponentKinds: { represents: ["Component"], roots: ["Components.Surface"] },
    },
  };
}

function read(): ManifestReader
{
  return ManifestReader.fromBinary(ManifestWriter.fromLogical(logical()).toBinary());
}

// Locate a TypeInfo row by name (helper — the bridge assigns rows by iteration order).
function typeRow(r: ManifestReader, name: string): number
{
  for (let i = 1; i <= r.rowCount(TableId.TypeInfo); i++)
    if (r.getString(r.typeInfo(i).name) === name) return i;
  return 0;
}

describe("ManifestWriter.fromLogical (SPEC-04 §9.2 — logical → binary)", () => {
  test("model/version/root carry over; the result validates", () => {
    const r = read();
    assert.equal(r.model, "shop");
    assert.equal(r.version, "1.0.0");
    assert.equal(r.getString(r.typeInfo(r.root.row).name), "Element");
    assert.equal(new ManifestValidator(r).isValid, true);
  });

  test("concepts become TypeInfo rows; Element has extends 0 (virtual root)", () => {
    const r = read();
    const element = typeRow(r, "Element");
    const component = typeRow(r, "Component");
    assert.equal(r.typeInfo(element).kind, MetaKind.Concept);
    assert.equal(r.typeInfo(element).extends, 0);
    // Component extends Element (coded TypeDefOrRef -> TypeInfo Element)
    const ext = r.decodeTypeRef(r.typeInfo(component).extends);
    assert.equal(ext.toTypeRef, false);
    assert.equal(ext.row, element);
  });

  test("declared-only fields become a contiguous Field slice with glyph cardinality", () => {
    const r = read();
    const component = typeRow(r, "Component");
    const fields = [...r.fieldsOf(component)].map((f) => ({
      name: r.getString(f.name), card: f.card,
    }));
    assert.deepEqual(fields, [
      { name: "name", card: Cardinality.One },
      { name: "color", card: Cardinality.Optional },
    ]);
    // Surface declares ONLY color (override), tightened to One
    const surface = typeRow(r, "Surface");
    const sf = [...r.fieldsOf(surface)];
    assert.equal(sf.length, 1);
    assert.equal(r.getString(sf[0]!.name), "color");
    assert.equal(sf[0]!.card, Cardinality.One);
  });

  test("field types referencing a primitive synthesize a local Primitive TypeInfo", () => {
    const r = read();
    const stringRow = typeRow(r, "string");
    assert.notEqual(stringRow, 0);
    assert.equal(r.typeInfo(stringRow).kind, MetaKind.Primitive);
    const nameField = [...r.fieldsOf(typeRow(r, "Component"))][0]!;
    assert.equal(r.decodeTypeRef(nameField.type).row, stringRow);
  });

  test("relationship lowers to Rel + Target with inverse", () => {
    const r = read();
    const rels = [...r.relsOf(typeRow(r, "Component"))];
    assert.equal(rels.length, 1);
    assert.equal(r.getString(rels[0]!.name), "dependsOn");
    assert.equal(rels[0]!.card, Cardinality.Many);
    assert.equal(r.getString(rels[0]!.inverse), "usedBy");
    const targets = [...r.targetsOf(1)].map((t) => r.decodeTypeRef(t.type).row);
    assert.deepEqual(targets, [typeRow(r, "Component")]);
  });

  test("class lowers to Class + Fixed pinning the right Field row and const value", () => {
    const r = read();
    assert.equal(r.rowCount(TableId.Class), 1);
    const cls = r.class_(1);
    assert.equal(r.getString(cls.name), "Components.Surface");
    assert.equal(r.decodeTypeRef(cls.type).row, typeRow(r, "Surface"));
    const fixed = [...r.fixedOf(1)];
    assert.equal(fixed.length, 1);
    // the pinned field is Surface.color
    assert.equal(r.getString(r.field(fixed[0]!.field).name), "color");
    assert.equal(r.getConst(fixed[0]!.value), "red");
  });

  test("taxonomy lowers to Taxonomy + represents Target", () => {
    const r = read();
    assert.equal(r.rowCount(TableId.Taxonomy), 1);
    const tax = r.taxonomy(1);
    assert.equal(r.getString(tax.name), "ComponentKinds");
    const represents = [...r.representsOf(1)].map((t) => r.decodeTypeRef(t.type).row);
    assert.deepEqual(represents, [typeRow(r, "Component")]);
    // the class points back at this taxonomy
    assert.equal(r.class_(1).taxonomy, 1);
  });
});
