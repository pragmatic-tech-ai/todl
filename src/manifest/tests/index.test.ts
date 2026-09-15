import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ManifestWriter, ManifestReader, ManifestValidator,
  MetaKind, Cardinality, TableId, TypeDefOrRef,
} from "../index.js";

describe("manifest module barrel (SPEC-04)", () => {
  test("public API builds, serialises, reads back, and validates", () => {
    const w = new ManifestWriter("m", "1.0.0");
    const f = w.addField({ name: w.internString("x"), type: 0, card: Cardinality.One });
    const t = w.addTypeInfo({
      name: w.internString("T"), ns: 0, kind: MetaKind.Concept,
      extends: 0, fieldStart: f, fieldCount: 1, relStart: 0, relCount: 0,
    });
    w.setRoot(t);

    const reader = ManifestReader.fromBinary(w.toBinary());
    assert.equal(reader.model, "m");
    assert.equal(reader.rowCount(TableId.TypeInfo), 1);
    assert.equal(TypeDefOrRef.decode(0).isNull, true);
    assert.equal(new ManifestValidator(reader).isValid, true);
  });
});
