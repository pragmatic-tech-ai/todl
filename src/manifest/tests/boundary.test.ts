import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ManifestWriter } from "../manifest-writer.js";
import { ManifestReader } from "../manifest-reader.js";
import { MetaKind } from "../enums.js";
import { TypeDefOrRef } from "../token.js";

function reservedFlags(bytes: Uint8Array): number
{
  return bytes[6]! | (bytes[7]! << 8); // header reserved u16 at offset 6
}

describe("index-width boundary at 65535 (SPEC-04 §11.6)", () => {
  test("#Strings past 0xFFFF entries widens Str columns to u32 and still round-trips", () => {
    const w = new ManifestWriter("big", "1.0.0");
    for (let i = 0; i < 0x10000; i++) w.internString("s" + i); // 65536 unique
    const t = w.addTypeInfo({
      name: w.internString("marker"), ns: 0, kind: MetaKind.Concept,
      extends: 0, fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0,
      annotStart: 0, annotCount: 0,
    });
    w.setRoot(t);
    const bytes = w.toBinary();
    assert.equal((reservedFlags(bytes) & (1 << 0)) !== 0, true); // #Strings widened

    const reader = ManifestReader.fromBinary(bytes);
    assert.equal(reader.getString(reader.typeInfo(1).name), "marker");
    // a high string index survives the u32 heap-index column
    assert.equal(reader.getString(0xffff), "s65534");
    assert.deepEqual(reader.toJSON(), w.toJSON());
  });

  test("TypeInfo past 32767 rows widens the coded TypeDefOrRef column to u32", () => {
    const w = new ManifestWriter("big2", "1.0.0");
    const base = w.addTypeInfo({
      name: w.internString("Base"), ns: 0, kind: MetaKind.Concept,
      extends: 0, fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0,
      annotStart: 0, annotCount: 0,
    });
    const extendsBase = new TypeDefOrRef(false, base).encode();
    for (let i = 0; i < 32768; i++)
    {
      w.addTypeInfo({
        name: w.internString("T" + i), ns: 0, kind: MetaKind.Concept,
        extends: extendsBase, fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0,
        annotStart: 0, annotCount: 0,
      });
    }
    const bytes = w.toBinary();
    assert.equal((reservedFlags(bytes) & (1 << 13)) !== 0, true); // coded widened
    // TypeInfo has 32769 rows (< 65536) so its own row-index stays u16
    assert.equal((reservedFlags(bytes) & (1 << 2)) !== 0, false);

    const reader = ManifestReader.fromBinary(bytes);
    assert.equal(reader.rowCount(0 /* TableId.TypeInfo */), 32769);
    const last = reader.typeInfo(32769);
    const decoded = reader.decodeTypeRef(last.extends);
    assert.equal(decoded.toTypeRef, false);
    assert.equal(decoded.row, 1); // still points at Base through the u32 column
  });
});
