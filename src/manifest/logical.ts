// The LOGICAL manifest model (SPEC-03): the human-readable, JSON-shaped
// meta/ontology sidecar that preserves a flattened node's field origins. This
// is the source of truth SPEC-04 mirrors 1:1 as binary tables + heaps, and the
// type SPEC-04's deferred `ManifestWriter.fromLogical` will consume. Resolution
// over it answers the two provenance axes:
//   Axis 1 (type-origin, travels `extends`)  — typeOriginOf
//   Axis 2 (value-origin, travels class-of)   — valueOriginOf

import { Cardinality } from "./enums.js";

/** A literal field value (mirrors src/model/graph.ts Scalar). */
export type Scalar = string | number | boolean;

/** Multiplicity glyphs on the wire (JOURNAL contract). */
export type CardGlyph = "1" | "?" | "*" | "+"; // One | Optional | Many | OneOrMore

export interface FieldDef
{
    /** Scalar field type — a primitive/concept id (a TypeInfo ref in SPEC-04). */
    type: string;
    card: CardGlyph;
}

/** An applied annotation (annotation type id + its argument values). */
export interface AnnotationApp
{
    /** The annotation type id (e.g. "icon"). */
    annotation: string;
    /** The annotation's argument values, keyed by parameter name. */
    args: Record<string, Scalar>;
}

export interface RelationshipDef
{
    /** One or more target concept ids (union). */
    targets: string[];
    card: CardGlyph;
    /** Inverse relationship name on the target, or omitted if none. */
    inverse?: string;
    /** Annotations applied to this relationship member. */
    annotations: AnnotationApp[];
}

export interface ConceptDef
{
    /** Single direct parent id; null only for the root `Element`. */
    extends: string | null;
    /** DECLARED-OWN scalar fields, keyed by field name. */
    fields: Record<string, FieldDef>;
    /** DECLARED-OWN reference relationships, keyed by relationship name. */
    relationships: Record<string, RelationshipDef>;
    /** Opaque invariant expressions for v1. */
    invariants: string[];
    /** Annotations applied to this concept. */
    annotations: AnnotationApp[];
}

export interface ClassDef
{
    /** The concept this class/term is a partial instance of. */
    concept: string;
    /** The taxonomy this term belongs to, if any. */
    taxonomy?: string;
    /** Direct broader term (parent in the taxonomy), if any. */
    broader?: string;
    /** Direct narrower terms (children in the taxonomy). */
    narrower: string[];
    /** The field values this class pins — the Axis-2 value-origin authority. */
    fixed: Record<string, Scalar>;
    /** Annotations applied to this class/term. */
    annotations: AnnotationApp[];
}

export interface TaxonomyDef
{
    /** The concept(s) this taxonomy represents. */
    represents: string[];
    /** The root term id(s) of the taxonomy. */
    roots: string[];
}

export interface LogicalManifest
{
    format: "todl-manifest/1";
    model: string;
    version: string;
    /** The virtual root; always "Element". */
    root: string;
    concepts: Record<string, ConceptDef>;
    classes: Record<string, ClassDef>;
    taxonomies: Record<string, TaxonomyDef>;
}

/** A flattened instance node as seen by Axis-2 resolution (SPEC-03 §graph). */
export interface FlatNode
{
    class?: string | null;
    attrs: Record<string, Scalar>;
}

/** The sentinel `valueOriginOf` returns when a value is the instance's own. */
export const SELF_ORIGIN = "self";

/** `Cardinality` enum ↔ wire glyph (JOURNAL: 1→0, ?→1, *→2, +→3). */
export class CardinalityGlyph
{
    static toGlyph(card: Cardinality): CardGlyph
    {
        switch (card)
        {
            case Cardinality.One:
                return "1";
            case Cardinality.Optional:
                return "?";
            case Cardinality.Many:
                return "*";
            case Cardinality.OneOrMore:
                return "+";
        }
    }

    static fromGlyph(glyph: CardGlyph): Cardinality
    {
        switch (glyph)
        {
            case "1":
                return Cardinality.One;
            case "?":
                return Cardinality.Optional;
            case "*":
                return Cardinality.Many;
            case "+":
                return Cardinality.OneOrMore;
        }
    }
}

/**
 * A resolution façade over a `LogicalManifest`. Wraps the plain JSON data and
 * answers the two provenance axes; `toJSON` returns the underlying data so the
 * logical model round-trips through JSON as an identity.
 */
export class ManifestModel
{
    constructor(private readonly data: LogicalManifest) {}

    static fromJSON(json: LogicalManifest): ManifestModel
    {
        return new ManifestModel(json);
    }

    /** The underlying logical manifest (identity JSON view). */
    toJSON(): LogicalManifest
    {
        return this.data;
    }

    get manifest(): LogicalManifest
    {
        return this.data;
    }

    /** The `extends` chain from a type up to (and including) `Element`. */
    ancestorsViaExtends(type: string): string[]
    {
        const chain: string[] = [];
        let current = this.data.concepts[type]?.extends ?? null;
        while (current !== null)
        {
            chain.push(current);
            current = this.data.concepts[current]?.extends ?? null;
        }
        return chain;
    }

    /** Axis 1: the nearest concept declaring `field` on `type` (subtype wins). */
    typeOriginOf(type: string, field: string): string | undefined
    {
        for (const concept of [type, ...this.ancestorsViaExtends(type)])
        {
            if (this.data.concepts[concept]?.fields[field] !== undefined) return concept;
        }
        return undefined;
    }

    /** Axis 1 for relationships: the nearest concept declaring `rel`. */
    relationshipOriginOf(type: string, rel: string): string | undefined
    {
        for (const concept of [type, ...this.ancestorsViaExtends(type)])
        {
            if (this.data.concepts[concept]?.relationships[rel] !== undefined) return concept;
        }
        return undefined;
    }

    /**
     * Axis 2: whether `field`'s value on `node` came from its class (returns the
     * class id) or is the instance's own (`SELF_ORIGIN`). A value is attributed
     * to the class only when the class pins that field AND the flattened value
     * equals the pinned value.
     */
    valueOriginOf(node: FlatNode, field: string): string
    {
        const cls = node.class ?? null;
        if (cls === null) return SELF_ORIGIN;
        const fixed = this.data.classes[cls]?.fixed ?? {};
        if (field in fixed && fixed[field] === node.attrs[field]) return cls;
        return SELF_ORIGIN;
    }
}
