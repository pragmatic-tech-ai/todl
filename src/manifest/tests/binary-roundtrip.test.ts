import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ManifestWriter } from "../manifest-writer.js";
import { ManifestReader } from "../manifest-reader.js";
import { ManifestSchema } from "../schema.js";
import { MetaKind, Cardinality, TableId } from "../enums.js";
import { TypeDefOrRef } from "../token.js";

function buildShop(): ManifestWriter
{
  const w = new ManifestWriter("shop", "1.2.0");
  const fName = w.addField({ name: w.internString("name"), type: 0, card: Cardinality.One });
  w.addField({ name: w.internString("size"), type: 0, card: Cardinality.Optional });
  const base = w.addTypeInfo({
    name: w.internString("Element"), ns: 0, kind: MetaKind.Concept,
    extends: 0, fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0,
    annotStart: 0, annotCount: 0,
  });
  const comp = w.addTypeInfo({
    name: w.internString("Component"), ns: w.internString("shop"), kind: MetaKind.Concept,
    extends: new TypeDefOrRef(false, base).encode(),
    fieldStart: fName, fieldCount: 2, relStart: 0, relCount: 0,
    annotStart: 0, annotCount: 0,
  });
  // a class pinning a fixed value → exercises Class/Fixed/#Const
  const fx = w.addFixed({ field: fName, value: w.internConst("widget") });
  w.addClass({
    name: w.internString("Widget"), type: new TypeDefOrRef(false, comp).encode(),
    taxonomy: 0, broader: 0, fixedStart: fx, fixedCount: 1,
    annotStart: 0, annotCount: 0,
  });
  w.setRoot(comp);
  return w;
}

describe("binary round-trip (SPEC-04 §7, §11.4)", () => {
  test("magic prefix is ASCII 'TODM'", () => {
    const bytes = buildShop().toBinary();
    assert.deepEqual(Array.from(bytes.subarray(0, 4)), [0x54, 0x4f, 0x44, 0x4d]);
  });

  test("writer.toBinary → reader reproduces header + heaps + rows", () => {
    const w = buildShop();
    const reader = ManifestReader.fromBinary(w.toBinary());
    assert.equal(reader.model, "shop");
    assert.equal(reader.version, "1.2.0");
    assert.equal(reader.formatVersion, ManifestSchema.FORMAT_VERSION);
    assert.equal(reader.root.table, TableId.TypeInfo);
    assert.equal(reader.root.row, 2);
    assert.equal(reader.rowCount(TableId.Field), 2);
    assert.equal(reader.rowCount(TableId.TypeInfo), 2);
    assert.equal(reader.rowCount(TableId.Class), 1);
    assert.equal(reader.getString(reader.typeInfo(2).name), "Component");
    assert.equal(reader.getConst(reader.fixed(1).value), "widget");
  });

  test("decoded TypeInfo row is byte-faithful to what was written", () => {
    const reader = ManifestReader.fromBinary(buildShop().toBinary());
    const comp = reader.typeInfo(2);
    assert.equal(reader.getString(comp.name), "Component");
    assert.equal(reader.getString(comp.ns), "shop");
    assert.equal(comp.kind, MetaKind.Concept);
    const base = reader.decodeTypeRef(comp.extends);
    assert.equal(base.toTypeRef, false);
    assert.equal(base.row, 1); // Element
    assert.equal(comp.fieldCount, 2);
  });

  test("reader.toJSON deep-equals writer.toJSON (positional parity)", () => {
    const w = buildShop();
    const reader = ManifestReader.fromBinary(w.toBinary());
    assert.deepEqual(reader.toJSON(), w.toJSON());
  });

  test("empty manifest round-trips", () => {
    const w = new ManifestWriter("empty", "0.0.0");
    const reader = ManifestReader.fromBinary(w.toBinary());
    assert.equal(reader.model, "empty");
    assert.equal(reader.rowCount(TableId.TypeInfo), 0);
    assert.deepEqual(reader.toJSON(), w.toJSON());
  });
});
