import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ManifestWriter } from "../manifest-writer.js";
import { TableId, MetaKind, Cardinality } from "../enums.js";
import { TypeDefOrRef } from "../token.js";

describe("ManifestWriter — heap interning + row appenders (SPEC-04 §9.2)", () => {
  test("interning delegates to heaps; 0 for ''/null", () => {
    const w = new ManifestWriter("shop", "1.0.0");
    assert.equal(w.internString(""), 0);
    assert.equal(w.internString("Component"), 1);
    assert.equal(w.internString("Component"), 1); // dedupe
    assert.equal(w.internConst(null), 0);
    assert.equal(w.internConst(42n), 1);
  });

  test("row appenders return 1-based rows and grow rowCount", () => {
    const w = new ManifestWriter("shop", "1.0.0");
    const f1 = w.addField({ name: w.internString("name"), type: 0, card: Cardinality.One });
    const f2 = w.addField({ name: w.internString("size"), type: 0, card: Cardinality.Optional });
    assert.equal(f1, 1);
    assert.equal(f2, 2);
    assert.equal(w.rowCount(TableId.Field), 2);
    assert.equal(w.rowCount(TableId.TypeInfo), 0);
  });

  test("a type with a contiguous field slice records [start,count]", () => {
    const w = new ManifestWriter("shop", "1.0.0");
    // add fields first, capture the slice, then the owning type
    const start = w.rowCount(TableId.Field) + 1;
    w.addField({ name: w.internString("a"), type: 0, card: Cardinality.One });
    w.addField({ name: w.internString("b"), type: 0, card: Cardinality.Many });
    const count = w.rowCount(TableId.Field) - start + 1;
    const t = w.addTypeInfo({
      name: w.internString("Component"),
      ns: 0,
      kind: MetaKind.Concept,
      extends: 0,
      fieldStart: start,
      fieldCount: count,
      relStart: 0,
      relCount: 0,
    });
    assert.equal(t, 1);
    assert.equal(start, 1);
    assert.equal(count, 2);
  });

  test("extends stores an encoded TypeDefOrRef", () => {
    const w = new ManifestWriter("shop", "1.0.0");
    const base = w.addTypeInfo({
      name: w.internString("Element"), ns: 0, kind: MetaKind.Concept,
      extends: 0, fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0,
    });
    const derived = w.addTypeInfo({
      name: w.internString("Component"), ns: 0, kind: MetaKind.Concept,
      extends: new TypeDefOrRef(false, base).encode(),
      fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0,
    });
    assert.equal(base, 1);
    assert.equal(derived, 2);
    assert.equal(TypeDefOrRef.decode(new TypeDefOrRef(false, base).encode()).row, 1);
  });

  test("setRoot records the root type row", () => {
    const w = new ManifestWriter("shop", "1.0.0");
    const t = w.addTypeInfo({
      name: w.internString("Root"), ns: 0, kind: MetaKind.Concept,
      extends: 0, fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0,
    });
    w.setRoot(t);
    assert.equal(w.root, t);
  });
});
