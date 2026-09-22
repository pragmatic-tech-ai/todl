import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ManifestWriter } from "../manifest-writer.js";
import { ManifestReader } from "../manifest-reader.js";
import { ManifestValidator, IssueSeverity } from "../manifest-validator.js";
import { MetaKind, Cardinality } from "../enums.js";
import { TypeDefOrRef } from "../token.js";
import type { ManifestJson } from "../records.js";

function buildValid(): ManifestWriter
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

function jsonOf(w: ManifestWriter): ManifestJson
{
  w.toBinary(); // intern model/version
  return JSON.parse(JSON.stringify(w.toJSON()));
}

function errorsOf(json: ManifestJson): string[]
{
  return new ManifestValidator(ManifestReader.fromJSON(json))
    .validate()
    .filter((i) => i.severity === IssueSeverity.Error)
    .map((i) => i.message);
}

describe("ManifestValidator (SPEC-04 §10)", () => {
  test("a well-formed manifest is valid", () => {
    const v = new ManifestValidator(ManifestReader.fromBinary(buildValid().toBinary()));
    assert.equal(v.isValid, true);
    assert.deepEqual(v.validate(), []);
  });

  test("dangling #Strings index is flagged", () => {
    const json = jsonOf(buildValid());
    json.tables.TypeInfo[1]![0] = json.strings.length; // name index out of range
    assert.equal(errorsOf(json).some((m) => m.includes("#Strings index")), true);
  });

  test("out-of-range Cardinality code is flagged", () => {
    const json = jsonOf(buildValid());
    json.tables.Field[0]![2] = 9; // card
    assert.equal(errorsOf(json).some((m) => m.includes("Cardinality")), true);
  });

  test("out-of-range MetaKind code is flagged", () => {
    const json = jsonOf(buildValid());
    json.tables.TypeInfo[1]![2] = 42; // kind
    assert.equal(errorsOf(json).some((m) => m.includes("MetaKind")), true);
  });

  test("slice exceeding its target table is flagged", () => {
    const json = jsonOf(buildValid());
    json.tables.TypeInfo[1]![5] = 99; // fieldCount way past Field.rowCount
    assert.equal(errorsOf(json).some((m) => m.includes("slice")), true);
  });

  test("TypeRef tag with no TypeRef rows is flagged", () => {
    const json = jsonOf(buildValid());
    json.tables.Field[0]![1] = new TypeDefOrRef(true, 1).encode(); // type -> TypeRef row 1
    assert.equal(errorsOf(json).some((m) => m.includes("TypeRef")), true);
  });

  test("root out of range is flagged", () => {
    const json = jsonOf(buildValid());
    json.root = 999;
    assert.equal(errorsOf(json).some((m) => m.includes("root")), true);
  });

  test("non-Concept root is a warning, not an error", () => {
    const json = jsonOf(buildValid());
    json.tables.TypeInfo[1]![2] = MetaKind.Model; // root kind = Model
    const v = new ManifestValidator(ManifestReader.fromJSON(json));
    const issues = v.validate();
    assert.equal(issues.some((i) => i.severity === IssueSeverity.Warning), true);
    assert.equal(issues.every((i) => i.severity !== IssueSeverity.Error), true);
    assert.equal(v.isValid, true); // warnings don't invalidate
  });

  test("empty Imports.model and dangling TypeRef.import are flagged", () => {
    const json = jsonOf(buildValid());
    json.tables.Imports.push([0, 0]); // model=0 version=0
    json.tables.TypeRef.push([5, 1]); // import 5 out of range
    const errs = errorsOf(json);
    assert.equal(errs.some((m) => m.includes("model name is empty")), true);
    assert.equal(errs.some((m) => m.includes("import 5 out of range")), true);
  });
});
