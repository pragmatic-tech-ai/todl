// Frozen numeric codes for the manifest binary format (SPEC-04 §3, §7.2).
// These are the on-disk authority: DO NOT renumber — appended members only.
// The manifest module keeps its OWN numeric MetaKind independent of the string
// enum in src/model/kinds.ts (SPEC-04 §3.1); the SPEC-03 bridge maps, never casts.

/** Language construct of a type row (`TypeInfo.kind`). Codes 0..9. */
export enum MetaKind
{
    Concept = 0,
    Primitive = 1,
    Taxonomy = 2,
    Term = 3,
    Annotation = 4,
    Relationship = 5,
    Operator = 6,
    Viewpoint = 7,
    Model = 8,
    Package = 9,
}

/**
 * Field / relationship multiplicity. Codes 0..3; surface glyphs `T` `T?` `T[]`
 * `T[+]`. This is the SINGLE canonical cardinality for the whole package — the
 * model (`src/model/graph.ts`) re-exports it rather than declaring its own, so
 * the in-memory and on-disk tiers can never disagree. Frozen; append-only.
 */
export enum Cardinality
{
    One = 0,
    Optional = 1,
    Many = 2,
    OneOrMore = 3,
}

/** Stable table ids for the container directory (SPEC-04 §7.2). Frozen; append-only. */
export enum TableId
{
    TypeInfo = 0,
    Field = 1,
    Rel = 2,
    Target = 3,
    Class = 4,
    Fixed = 5,
    Taxonomy = 6,
    Imports = 7,
    TypeRef = 8,
}

/** Stable heap ids (SPEC-04 §7.2). */
export enum HeapId
{
    Strings = 0,
    Const = 1,
}
