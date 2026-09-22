import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ManifestWriter } from "../manifest-writer.js";
import { ManifestReader } from "../manifest-reader.js";
import { MetaKind, Cardinality } from "../enums.js";
import { TypeDefOrRef } from "../token.js";

// A canonical little manifest — shared by the golden fixture and the parity
// chains. Any change to the binary layout breaks the golden and must be a
// deliberate, reviewed update.
function buildCanonical(): ManifestWriter
{
  const w = new ManifestWriter("shop", "1.0.0");
  const fName = w.addField({ name: w.internString("name"), type: 0, card: Cardinality.One });
  const base = w.addTypeInfo({
    name: w.internString("Element"), ns: 0, kind: MetaKind.Concept,
    extends: 0, fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0,
    annotStart: 0, annotCount: 0,
  });
  const comp = w.addTypeInfo({
    name: w.internString("Component"), ns: w.internString("shop"), kind: MetaKind.Concept,
    extends: new TypeDefOrRef(false, base).encode(),
    fieldStart: fName, fieldCount: 1, relStart: 0, relCount: 0,
    annotStart: 0, annotCount: 0,
  });
  w.setRoot(comp);
  return w;
}

// Frozen bytes of buildCanonical().toBinary() — the format's golden fixture.
const GOLDEN_HEX =
  "544f444d010000000400050002000b02001300020000009c00000001050001000000c4" +
  "000000020d0000000000cc00000003020000000000cc00000004100000000000cc0000" +
  "0005040000000000cc00000006060000000000cc00000007040000000000cc00000008" +
  "040000000000cc00000009060000000000cc0000000a040000000000cc00000000cc00" +
  "00002300000001f0000000010000000002000000000000000000000000000000000000" +
  "030004000002000100010000000000000000000000010000000000000000046e616d65" +
  "07456c656d656e7409436f6d706f6e656e740473686f7005312e302e300000";

function toHex(bytes: Uint8Array): string
{
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

describe("golden fixture (SPEC-04 §11.4) — format is byte-stable", () => {
  test("canonical manifest serialises to the frozen golden bytes", () => {
    assert.equal(toHex(buildCanonical().toBinary()), GOLDEN_HEX);
  });

  test("golden bytes load back into an equivalent reader", () => {
    const bytes = Uint8Array.from(GOLDEN_HEX.match(/../g)!.map((h) => parseInt(h, 16)));
    const reader = ManifestReader.fromBinary(bytes);
    assert.equal(reader.model, "shop");
    assert.equal(reader.version, "1.0.0");
    assert.equal(reader.getString(reader.typeInfo(2).name), "Component");
  });
});

describe("binary ↔ JSON parity (SPEC-04 §11.2)", () => {
  test("re-serialising a loaded manifest reproduces identical bytes", () => {
    const bytes = buildCanonical().toBinary();
    const again = ManifestReader.fromBinary(bytes).toBinary();
    assert.deepEqual(Array.from(again), Array.from(bytes));
  });

  test("JSON round-trip: fromJSON(toJSON) re-emits the same JSON", () => {
    const w = buildCanonical();
    w.toBinary(); // interns model/version so both sides agree
    const json = w.toJSON();
    assert.deepEqual(ManifestReader.fromJSON(json).toJSON(), json);
  });

  test("both paths agree: fromJSON(json).toBinary() === writer.toBinary()", () => {
    const w = buildCanonical();
    const viaBinary = w.toBinary();
    const viaJson = ManifestReader.fromJSON(w.toJSON()).toBinary();
    assert.deepEqual(Array.from(viaJson), Array.from(viaBinary));
  });

  test("binary → JSON → binary is a fixed point", () => {
    const bytes = buildCanonical().toBinary();
    const json = ManifestReader.fromBinary(bytes).toJSON();
    const back = ManifestReader.fromJSON(json).toBinary();
    assert.deepEqual(Array.from(back), Array.from(bytes));
  });
});
