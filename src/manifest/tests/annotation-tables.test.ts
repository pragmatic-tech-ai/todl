import { test } from "node:test";
import assert from "node:assert/strict";
import { ManifestWriter } from "../manifest-writer.js";
import { ManifestReader } from "../manifest-reader.js";
import { TableId, MetaKind } from "../enums.js";
import { TypeDefOrRef } from "../token.js";

// Build a writer with an annotation type row, an annotated concept row, and one arg,
// then assert the tables round-trip through both JSON and binary.
function buildWriter(): ManifestWriter
{
    const w = new ManifestWriter("m", "1.0.0");
    // Row 1: the annotation type "icon" (kind Annotation).
    w.addTypeInfo({ name: w.internString("icon"), ns: 0, kind: MetaKind.Annotation, extends: 0, fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0, annotStart: 0, annotCount: 0 });
    // One arg (path = "a.svg") + one annotation application referencing the type row.
    const argStart = w.rowCount(TableId.AnnotationArg) + 1;
    w.addAnnotationArg({ name: w.internString("path"), value: w.internConst("a.svg") });
    const annotStart = w.rowCount(TableId.Annotation) + 1;
    w.addAnnotation({ annotation: new TypeDefOrRef(false, 1).encode(), argStart, argCount: 1 });
    // Row 2: a concept "Component" carrying that annotation slice.
    w.addTypeInfo({ name: w.internString("Component"), ns: 0, kind: MetaKind.Concept, extends: 0, fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0, annotStart, annotCount: 1 });
    return w;
}

function assertRoundTrip(r: ManifestReader): void
{
    const component = r.typeInfo(2);
    assert.equal(component.annotCount, 1);
    const apps = [...r.annotationsAt(component.annotStart, component.annotCount)];
    assert.equal(apps.length, 1);
    assert.equal(TypeDefOrRef.decode(apps[0]!.annotation).row, 1); // → the "icon" type row
    const args = [...r.argsOf(component.annotStart)];
    assert.equal(args.length, 1);
    assert.equal(r.getString(args[0]!.name), "path");
    assert.equal(r.getConst(args[0]!.value), "a.svg");
}

test("Annotation/AnnotationArg tables round-trip through JSON", () =>
{
    assertRoundTrip(ManifestReader.fromJSON(buildWriter().toJSON()));
});

test("Annotation/AnnotationArg tables round-trip through binary", () =>
{
    assertRoundTrip(ManifestReader.fromBinary(buildWriter().toBinary()));
});
