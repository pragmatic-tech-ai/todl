import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ManifestWriter } from "../manifest-writer.js";
import { MetaKind, Cardinality } from "../enums.js";
import { TypeDefOrRef } from "../token.js";
import { Base64 } from "../bytes.js";

function buildShop(): ManifestWriter {
  const w = new ManifestWriter("shop", "1.2.0");
  // Field "size" : Number(=0 for this fixture), Optional
  const fSize = w.addField({ name: w.internString("size"), type: 0, card: Cardinality.Optional });
  const base = w.addTypeInfo({
    name: w.internString("Element"), ns: 0, kind: MetaKind.Concept,
    extends: 0, fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0,
  });
  const comp = w.addTypeInfo({
    name: w.internString("Component"),
    ns: w.internString("shop"),
    kind: MetaKind.Concept,
    extends: new TypeDefOrRef(false, base).encode(),
    fieldStart: fSize, fieldCount: 1, relStart: 0, relCount: 0,
  });
  w.setRoot(comp);
  // one pinned value to exercise #Const
  w.internConst(42n);
  return w;
}

describe("ManifestWriter.toJSON — positional 1:1 mirror (SPEC-04 §8)", () => {
  test("header fields resolve model/version/root/format", () => {
    const j = buildShop().toJSON();
    assert.equal(j.format, "todl-manifest/1");
    assert.equal(j.model, "shop");
    assert.equal(j.version, "1.2.0");
    assert.equal(j.root, 2); // Component is the 2nd TypeInfo row
  });

  test("strings[] carries index-0 empty and interned entries in order", () => {
    const j = buildShop().toJSON();
    assert.equal(j.strings[0], "");
    assert.ok(j.strings.includes("Component"));
    assert.ok(j.strings.includes("shop"));
    assert.ok(j.strings.includes("Element"));
  });

  test("const[] is base64 with index-0 empty; decodes to the pinned value", () => {
    const j = buildShop().toJSON();
    assert.equal(j.const[0], Base64.encode(new Uint8Array(0)));
    // entry 1 is 42n encoded (tag 0x02 + i64 LE)
    const blob = Base64.decode(j.const[1]!);
    assert.equal(blob[0], 0x02);
  });

  test("rows are arrays of column values in binary column order", () => {
    const j = buildShop().toJSON();
    // Field row 1: [name, type, card]
    assert.deepEqual(j.tables.Field[0], [j.strings.indexOf("size"), 0, Cardinality.Optional]);
    // TypeInfo Component: [name, ns, kind, extends, fStart, fCount, rStart, rCount]
    const comp = j.tables.TypeInfo[1]!;
    assert.equal(comp[0], j.strings.indexOf("Component"));
    assert.equal(comp[1], j.strings.indexOf("shop"));
    assert.equal(comp[2], MetaKind.Concept);
    assert.equal(comp[3], new TypeDefOrRef(false, 1).encode()); // extends Element (row 1)
    assert.equal(comp[4], 1); // fieldStart
    assert.equal(comp[5], 1); // fieldCount
  });
});
