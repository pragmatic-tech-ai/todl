// Manifest table records (SPEC-04 §5) and the JSON debug view (§8).
//
// Every `*Rec` field is an ALREADY-INTERNED integer: a `#Strings` index, a
// 1-based table row, an encoded `TypeDefOrRef` (§6), or an enum code. The
// writer is a pure packer — it performs no name resolution over these.

import { MetaKind, Cardinality } from "./enums.js";

/** §5.1 TypeInfo (≈ TypeDef). `extends` is an encoded TypeDefOrRef (0 = none). */
export interface TypeInfoRec
{
    name: number; // #Strings
    ns: number; // #Strings (0 = none)
    kind: MetaKind;
    extends: number; // TypeDefOrRef coded (0 = none / virtual Element)
    fieldStart: number; // Field row (ignored when count 0)
    fieldCount: number;
    relStart: number; // Rel row
    relCount: number;
    annotStart: number; // Annotation row (ignored when count 0)
    annotCount: number;
}

/** §5.2 Field. `type` is an encoded TypeDefOrRef. */
export interface FieldRec
{
    name: number; // #Strings
    type: number; // TypeDefOrRef coded
    card: Cardinality;
}

/** §5.3 Rel (≈ Property). */
export interface RelRec
{
    name: number; // #Strings
    targetStart: number; // Target row
    targetCount: number;
    card: Cardinality;
    inverse: number; // #Strings (0 = none)
    annotStart: number; // Annotation row (ignored when count 0)
    annotCount: number;
}

/** §5.4 Target. */
export interface TargetRec
{
    type: number; // TypeDefOrRef coded
}

/** §5.5 Class (terms / value-origin providers — Axis 2). */
export interface ClassRec
{
    name: number; // #Strings (the localId)
    type: number; // TypeDefOrRef coded (the concept it is-a)
    taxonomy: number; // Taxonomy row (0 = none)
    broader: number; // Class row (0 = root)
    fixedStart: number; // Fixed row
    fixedCount: number;
    annotStart: number; // Annotation row (ignored when count 0)
    annotCount: number;
}

/** §5.6 Fixed. */
export interface FixedRec
{
    field: number; // Field row
    value: number; // #Const index
}

/** §5.7 Taxonomy. `represents` reuses the Target table. */
export interface TaxonomyRec
{
    name: number; // #Strings
    representsStart: number; // Target row
    representsCount: number;
}

/** §5.8 Imports (≈ AssemblyRef). */
export interface ImportsRec
{
    model: number; // #Strings
    version: number; // #Strings
}

/** §5.9 TypeRef (≈ TypeRef). */
export interface TypeRefRec
{
    import: number; // Imports row
    name: number; // #Strings (fully-qualified name in the dep)
}

/** §5.10 Annotation (an applied annotation on a type / member / term). */
export interface AnnotationRec
{
    annotation: number; // TypeDefOrRef coded (the annotation type)
    argStart: number; // AnnotationArg row
    argCount: number;
}

/** §5.11 AnnotationArg (one argument of an applied annotation). */
export interface AnnotationArgRec
{
    name: number; // #Strings
    value: number; // #Const index
}

/**
 * The JSON debug view (§8): a positional 1:1 mirror of the binary — same
 * column order, same numeric indices (NOT names, NOT resolved values). Rows
 * are arrays of column values in binary column order; `const[]` entries are
 * base64 of the raw blob bytes.
 */
export interface ManifestJson
{
    format: string; // "todl-manifest/1"
    model: string;
    version: string;
    root: number; // TypeInfo row (plain, not coded)
    strings: string[]; // index 0 = ""
    const: string[]; // base64 per blob, index 0 = ""
    tables: {
        TypeInfo: number[][];
        Field: number[][];
        Rel: number[][];
        Target: number[][];
        Class: number[][];
        Fixed: number[][];
        Taxonomy: number[][];
        Imports: number[][];
        TypeRef: number[][];
        Annotation: number[][];
        AnnotationArg: number[][];
    };
}
