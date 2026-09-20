import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ManifestWriter } from "../manifest-writer.js";
import { ManifestReader } from "../manifest-reader.js";
import { MetaKind, Cardinality } from "../enums.js";
import { TypeDefOrRef } from "../token.js";

describe("Imports / TypeRef cross-manifest references (SPEC-04 §5.8–5.9)", () => {
  test("a field typed by a dependency's type round-trips through TypeRef", () => {
    const w = new ManifestWriter("shop", "1.0.0");
    // dependency + a type declared in it
    const dep = w.addImport({ model: w.internString("core"), version: w.internString("2.1.0") });
    const ref = w.addTypeRef({ import: dep, name: w.internString("Money") });
    // a field whose type is that external type (coded tag = TypeRef)
    const fPrice = w.addField({
      name: w.internString("price"),
      type: new TypeDefOrRef(true, ref).encode(),
      card: Cardinality.One,
    });
    const t = w.addTypeInfo({
      name: w.internString("Product"), ns: 0, kind: MetaKind.Concept,
      extends: 0, fieldStart: fPrice, fieldCount: 1, relStart: 0, relCount: 0,
    });
    w.setRoot(t);

    const reader = ManifestReader.fromBinary(w.toBinary());
    const price = reader.field(1);
    const coded = reader.decodeTypeRef(price.type);
    assert.equal(coded.toTypeRef, true);
    const tr = reader.typeRef(coded.row);
    assert.equal(reader.getString(tr.name), "Money");
    const imp = reader.import_(tr.import);
    assert.equal(reader.getString(imp.model), "core");
    assert.equal(reader.getString(imp.version), "2.1.0");
    assert.deepEqual(reader.toJSON(), w.toJSON());
  });
});

describe("slice iterators (SPEC-04 §9.3)", () => {
  function build(): ManifestReader
  {
    const w = new ManifestWriter("m", "1.0.0");
    // two fields for a type
    const fStart = w.addField({ name: w.internString("a"), type: 0, card: Cardinality.One });
    w.addField({ name: w.internString("b"), type: 0, card: Cardinality.Many });
    // a rel with two targets
    const concept = w.addTypeInfo({
      name: w.internString("Widget"), ns: 0, kind: MetaKind.Concept,
      extends: 0, fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0,
    });
    const tStart = w.addTarget({ type: new TypeDefOrRef(false, concept).encode() });
    w.addTarget({ type: new TypeDefOrRef(false, concept).encode() });
    const relRow = w.addRel({
      name: w.internString("uses"), targetStart: tStart, targetCount: 2,
      card: Cardinality.Many, inverse: 0,
    });
    const owner = w.addTypeInfo({
      name: w.internString("Comp"), ns: 0, kind: MetaKind.Concept,
      extends: 0, fieldStart: fStart, fieldCount: 2, relStart: relRow, relCount: 1,
    });
    // a taxonomy representing one concept + a class with two fixed values
    const rStart = w.addTarget({ type: new TypeDefOrRef(false, concept).encode() });
    const tax = w.addTaxonomy({
      name: w.internString("Kinds"), representsStart: rStart, representsCount: 1,
    });
    const fxStart = w.addFixed({ field: fStart, value: w.internConst("x") });
    w.addFixed({ field: fStart, value: w.internConst("y") });
    w.addClass({
      name: w.internString("Special"), type: new TypeDefOrRef(false, owner).encode(),
      taxonomy: tax, broader: 0, fixedStart: fxStart, fixedCount: 2,
    });
    w.setRoot(owner);
    return ManifestReader.fromBinary(w.toBinary());
  }

  test("fieldsOf / relsOf / targetsOf walk their captured slices", () => {
    const r = build();
    const owner = 2; // Comp
    assert.deepEqual([...r.fieldsOf(owner)].map((f) => r.getString(f.name)), ["a", "b"]);
    const rels = [...r.relsOf(owner)];
    assert.equal(rels.length, 1);
    assert.equal(r.getString(rels[0]!.name), "uses");
    assert.equal([...r.targetsOf(1)].length, 2); // rel row 1 has 2 targets
  });

  test("fixedOf / representsOf walk their captured slices", () => {
    const r = build();
    const fixed = [...r.fixedOf(1)]; // class row 1
    assert.deepEqual(fixed.map((f) => r.getConst(f.value)), ["x", "y"]);
    assert.equal([...r.representsOf(1)].length, 1); // taxonomy row 1
  });

  test("an empty slice yields nothing", () => {
    const r = build();
    assert.deepEqual([...r.fieldsOf(1)], []); // Widget has no fields
  });
});
