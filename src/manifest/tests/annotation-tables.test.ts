import { test } from "node:test";
import assert from "node:assert/strict";
import { ManifestWriter } from "../manifest-writer.js";
import { ManifestReader } from "../manifest-reader.js";
import { TableId, MetaKind } from "../enums.js";
import { TypeDefOrRef } from "../token.js";
import type { LogicalManifest } from "../logical.js";

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

// A hand-built logical manifest carrying a concept annotation (icon) and a
// relationship-member annotation (iconSource), neither of which is a concept —
// fromLogical must synthesize Annotation-kind TypeInfo rows for them.
function logical(): LogicalManifest
{
    return {
        format: "todl-manifest/1", model: "acme", version: "1.0.0", root: "Element",
        concepts: {
            Component: {
                extends: null,
                fields: { name: { type: "string", card: "1" } },
                relationships: {
                    implementedBy: {
                        targets: ["Technology"], card: "?",
                        annotations: [{ annotation: "iconSource", args: { order: 1 } }],
                    },
                },
                invariants: [],
                annotations: [{ annotation: "icon", args: { path: "c.svg" } }],
            },
            Technology: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
        },
        classes: {}, taxonomies: {},
    };
}

test("fromLogical packs concept + relationship annotations and synthesizes the annotation type", () =>
{
    const reader = ManifestReader.fromJSON(ManifestWriter.fromLogical(logical()).toJSON());

    // "Component" is TypeInfo row 1; it carries one annotation resolving to "icon".
    const component = reader.typeInfo(1);
    const apps = [...reader.annotationsAt(component.annotStart, component.annotCount)];
    assert.equal(apps.length, 1);
    const iconRow = TypeDefOrRef.decode(apps[0]!.annotation).row;
    assert.equal(reader.getString(reader.typeInfo(iconRow).name), "icon");
    assert.equal(reader.typeInfo(iconRow).kind, MetaKind.Annotation);
    const args = [...reader.argsOf(component.annotStart)];
    assert.equal(reader.getString(args[0]!.name), "path");
    assert.equal(reader.getConst(args[0]!.value), "c.svg");

    // The relationship row carries the iconSource annotation.
    const rel = reader.rel(component.relStart);
    assert.equal(rel.annotCount, 1);
    const relApp = [...reader.annotationsAt(rel.annotStart, rel.annotCount)][0]!;
    assert.equal(reader.getString(reader.typeInfo(TypeDefOrRef.decode(relApp.annotation).row).name), "iconSource");
});
