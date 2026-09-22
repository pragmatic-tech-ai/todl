// Reflection API (SPEC-05): a read-only, lazy surface over one loaded manifest,
// modelled 1:1 on .NET System.Reflection. Every handle is a `(Manifest, row)`
// pair; accessors are numeric table lookups against the SPEC-04 tables. Nothing
// mutates. The whole handle cluster lives in one module so the mutual class
// references (TypeInfo ↔ FieldInfo ↔ Manifest) never hit an ESM
// class-extends-undefined cycle; the `Manifest` is the handle factory.
//
// Two shape notes (deliberate, recorded in JOURNAL):
//  1. Reflection consumes the FLATTENED data node (`type`/`class`/`attrs`/
//     `refs`) produced by the SPEC-03 emitter, not `src/model/graph.ts` Node
//     (which has no node-root type/class — that is the SPEC-01 shape). The
//     interface is local + structural so no import cycle to `src/emit`.
//  2. `getAnnotations()` reads the SPEC-04 Annotation table (types / members /
//     terms); `FieldInfo.getAnnotations()` stays `[]` (fields have no own node).
//     `getInvariants()` still returns `[]` — no invariant table yet (deferred).

import { TableId, MetaKind, Cardinality } from "../enums.js";
import { TypeDefOrRef } from "../token.js";
import { ManifestReader } from "../manifest-reader.js";
import type { ManifestJson } from "../records.js";
import type { Scalar } from "../logical.js";

/** A metadata token: a numeric (table, row) address, stable within one Manifest. */
export type Token = number;

/** A flattened, self-contained data-graph node reflection reads instance data from. */
export interface ReflectedNode
{
    id: string;
    /** The node's concept id (resolved via Manifest.getType). */
    type: string;
    /** The node's class/term id (resolved via Manifest.getTerm), or none. */
    class?: string | null;
    namespace?: string;
    /** User scalar values. */
    attrs: Record<string, Scalar>;
    /** Relationship targets by member name (self-contained flattened refs). */
    refs?: Record<string, string[]>;
}

/**
 * A multi-manifest host (the SPEC-06 Domain) a Manifest back-links to, so a
 * cross-manifest `TypeRef` can hop into a dependency manifest. A real interface
 * the Domain implements — not a lambda seam.
 */
export interface ManifestHost
{
    getManifest(model: string, version?: string): Manifest | undefined;
}

/** Numeric token codec: `table * 2^32 + row`. Row 0 of TypeInfo (table 0) = 0 = null. */
export class Tokens
{
    private static readonly STRIDE = 0x100000000; // 2^32; rows are u32

    static of(table: TableId, row: number): Token
    {
        return table * Tokens.STRIDE + row;
    }

    static table(token: Token): TableId
    {
        return Math.floor(token / Tokens.STRIDE);
    }

    static row(token: Token): number
    {
        return token % Tokens.STRIDE;
    }
}

/** The Assembly analog — the reflection root and handle factory. */
export class Manifest
{
    private host: ManifestHost | undefined;

    private constructor(private readonly reader: ManifestReader) {}

    /** Load from the SPEC-04 binary container or its JSON debug view. */
    static load(source: Uint8Array | ManifestJson): Manifest
    {
        const reader = source instanceof Uint8Array
            ? ManifestReader.fromBinary(source)
            : ManifestReader.fromJSON(source);
        return new Manifest(reader);
    }

    /** Set (or clear) the Domain back-link used for cross-manifest TypeRef hops. */
    setHost(host: ManifestHost | undefined): void
    {
        this.host = host;
    }

    get model(): string
    {
        return this.reader.model;
    }

    get version(): string
    {
        return this.reader.version;
    }

    /** The virtual root type — `Element`. Its baseType is undefined. */
    root(): TypeInfo
    {
        return this.typeAt(this.reader.root.row);
    }

    /** Every TypeInfo row (concepts, primitives, taxonomies, …). */
    types(): TypeInfo[]
    {
        const out: TypeInfo[] = [];
        for (let row = 1; row <= this.reader.rowCount(TableId.TypeInfo); row++) out.push(this.typeAt(row));
        return out;
    }

    /** Resolve a type by simple name, then by fullName; undefined if absent. */
    getType(name: string): TypeInfo | undefined
    {
        let full: TypeInfo | undefined;
        for (const t of this.types())
        {
            if (t.name === name) return t;
            if (t.fullName === name) full = t;
        }
        return full;
    }

    /** Every taxonomy in this manifest. */
    taxonomies(): TaxonomyInfo[]
    {
        const out: TaxonomyInfo[] = [];
        for (let row = 1; row <= this.reader.rowCount(TableId.Taxonomy); row++) out.push(this.taxonomyAt(row));
        return out;
    }

    getTaxonomy(name: string): TaxonomyInfo | undefined
    {
        return this.taxonomies().find((t) => t.name === name);
    }

    /** A term (Class-table row) by its logical id, e.g. "Components.Surface". */
    getTerm(id: string): TermInfo | undefined
    {
        for (let row = 1; row <= this.reader.rowCount(TableId.Class); row++)
        {
            const term = this.termAt(row);
            if (term.id === id) return term;
        }
        return undefined;
    }

    /** Turn any intra-manifest token back into its handle. 0 → undefined. */
    resolveToken(token: Token): TypeInfo | MemberInfo | TermInfo | TaxonomyInfo | undefined
    {
        if (token === 0) return undefined;
        const row = Tokens.row(token);
        switch (Tokens.table(token))
        {
            case TableId.TypeInfo:
                return this.typeAt(row);
            case TableId.Field:
            {
                const declarer = this.fieldDeclarer(row);
                return declarer !== undefined ? this.fieldAt(row, declarer, declarer) : undefined;
            }
            case TableId.Rel:
            {
                const declarer = this.relDeclarer(row);
                return declarer !== undefined ? this.relAt(row, declarer, declarer) : undefined;
            }
            case TableId.Class:
                return this.termAt(row);
            case TableId.Taxonomy:
                return this.taxonomyAt(row);
            default:
                return undefined;
        }
    }

    /** The Axis-1 + Axis-2 payoff: reflect a data-graph node into a mirror. */
    reflect(node: ReflectedNode): InstanceMirror
    {
        return new InstanceMirror(this, node);
    }

    // ── internal factory + table access (used by handles in this module) ──

    /** @internal */ get tables(): ManifestReader
    {
        return this.reader;
    }

    /** @internal */ typeAt(row: number): TypeInfo
    {
        return new TypeInfo(this, row);
    }

    /** @internal */ fieldAt(row: number, declaringType: TypeInfo, reflectedType: TypeInfo): FieldInfo
    {
        return new FieldInfo(this, row, declaringType, reflectedType);
    }

    /** @internal */ relAt(row: number, declaringType: TypeInfo, reflectedType: TypeInfo): RelationshipInfo
    {
        return new RelationshipInfo(this, row, declaringType, reflectedType);
    }

    /** @internal */ termAt(row: number): TermInfo
    {
        return new TermInfo(this, row);
    }

    /** @internal */ taxonomyAt(row: number): TaxonomyInfo
    {
        return new TaxonomyInfo(this, row);
    }

    /**
     * @internal Resolve a coded TypeDefOrRef to a TypeInfo. Intra-manifest refs
     * read the local TypeInfo table; a TypeRef hops into a dependency manifest
     * via the Domain back-link (Imports → getManifest → getType). Returns
     * undefined if the hop is needed but no host is set (single-manifest use).
     */
    resolveTypeRef(coded: number): TypeInfo | undefined
    {
        if (coded === 0) return undefined;
        const ref = TypeDefOrRef.decode(coded);
        if (!ref.toTypeRef) return this.typeAt(ref.row);
        if (this.host === undefined) return undefined;
        const typeRef = this.reader.typeRef(ref.row);
        const imp = this.reader.import_(typeRef.import);
        const dep = this.host.getManifest(
            this.reader.getString(imp.model),
            this.reader.getString(imp.version),
        );
        return dep?.getType(this.reader.getString(typeRef.name));
    }

    /**
     * @internal Build AnnotationInfo[] for a parent's `[start, count]` annotation
     * slice. Each Annotation row resolves its coded annotation type and reads its
     * AnnotationArg slice into a name→value map.
     */
    annotationsFor(start: number, count: number): AnnotationInfo[]
    {
        const out: AnnotationInfo[] = [];
        for (let i = 0; i < count; i++)
        {
            const rowNum = start + i;
            const rec = this.reader.annotation(rowNum);
            const type = this.resolveTypeRef(rec.annotation);
            if (type === undefined) continue; // defensive: dangling annotation type
            const args = new Map<string, Scalar>();
            for (const arg of this.reader.argsOf(rowNum))
            {
                const value = this.reader.getConst(arg.value);
                if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
                    args.set(this.reader.getString(arg.name), value);
            }
            out.push(new AnnotationInfo(type, args));
        }
        return out;
    }

    /** @internal The concept whose declared Field slice contains `fieldRow`. */
    private fieldDeclarer(fieldRow: number): TypeInfo | undefined
    {
        for (let t = 1; t <= this.reader.rowCount(TableId.TypeInfo); t++)
        {
            const rec = this.reader.typeInfo(t);
            if (rec.fieldCount > 0 && fieldRow >= rec.fieldStart && fieldRow < rec.fieldStart + rec.fieldCount)
                return this.typeAt(t);
        }
        return undefined;
    }

    /** @internal The concept whose declared Rel slice contains `relRow`. */
    private relDeclarer(relRow: number): TypeInfo | undefined
    {
        for (let t = 1; t <= this.reader.rowCount(TableId.TypeInfo); t++)
        {
            const rec = this.reader.typeInfo(t);
            if (rec.relCount > 0 && relRow >= rec.relStart && relRow < rec.relStart + rec.relCount)
                return this.typeAt(t);
        }
        return undefined;
    }
}

/** The Type analog — a row in the TypeInfo table. */
export class TypeInfo
{
    constructor(private readonly manifest: Manifest, private readonly row: number) {}

    private get rec()
    {
        return this.manifest.tables.typeInfo(this.row);
    }

    get token(): Token
    {
        return Tokens.of(TableId.TypeInfo, this.row);
    }

    get name(): string
    {
        return this.manifest.tables.getString(this.rec.name);
    }

    get namespace(): string
    {
        return this.manifest.tables.getString(this.rec.ns);
    }

    get fullName(): string
    {
        const ns = this.namespace;
        return ns.length > 0 ? `${ns}.${this.name}` : this.name;
    }

    get kind(): MetaKind
    {
        return this.rec.kind;
    }

    /** The single `extends` parent, or undefined for Element (virtual root). */
    get baseType(): TypeInfo | undefined
    {
        return this.manifest.resolveTypeRef(this.rec.extends);
    }

    /** DeclaredOnly: this type's own field rows. */
    getDeclaredFields(): FieldInfo[]
    {
        const rec = this.rec;
        const out: FieldInfo[] = [];
        for (let i = 0; i < rec.fieldCount; i++) out.push(this.manifest.fieldAt(rec.fieldStart + i, this, this));
        return out;
    }

    /** DeclaredOnly relationships. */
    getDeclaredRelationships(): RelationshipInfo[]
    {
        const rec = this.rec;
        const out: RelationshipInfo[] = [];
        for (let i = 0; i < rec.relCount; i++) out.push(this.manifest.relAt(rec.relStart + i, this, this));
        return out;
    }

    /** Effective fields: own + inherited via baseType; override → nearest declarer wins. */
    getFields(): FieldInfo[]
    {
        const seen = new Set<string>();
        const out: FieldInfo[] = [];
        for (const ancestor of [this as TypeInfo, ...this.getSupertypes()])
        {
            for (const f of ancestor.getDeclaredFields())
            {
                if (seen.has(f.name)) continue;
                seen.add(f.name);
                out.push(this.manifest.fieldAt(Tokens.row(f.token), f.declaringType, this));
            }
        }
        return out;
    }

    getField(name: string): FieldInfo | undefined
    {
        return this.getFields().find((f) => f.name === name);
    }

    /** Effective relationships (own + inherited; override → nearest wins). */
    getRelationships(): RelationshipInfo[]
    {
        const seen = new Set<string>();
        const out: RelationshipInfo[] = [];
        for (const ancestor of [this as TypeInfo, ...this.getSupertypes()])
        {
            for (const r of ancestor.getDeclaredRelationships())
            {
                if (seen.has(r.name)) continue;
                seen.add(r.name);
                out.push(this.manifest.relAt(Tokens.row(r.token), r.declaringType, this));
            }
        }
        return out;
    }

    /** Effective fields ∪ relationships. */
    getMembers(): MemberInfo[]
    {
        return [...this.getFields(), ...this.getRelationships()];
    }

    /** The extends chain upward, excluding self, ending at Element. */
    getSupertypes(): TypeInfo[]
    {
        const out: TypeInfo[] = [];
        let base = this.baseType;
        while (base !== undefined)
        {
            out.push(base);
            base = base.baseType;
        }
        return out;
    }

    /** Strict, transitive: this is a proper subtype of `other` via extends. */
    isSubtypeOf(other: TypeInfo): boolean
    {
        return this.getSupertypes().some((t) => t.token === other.token);
    }

    /** Reflexive: `this` is assignable FROM `other` (other == this or subtype). */
    isAssignableFrom(other: TypeInfo): boolean
    {
        return other.token === this.token || other.isSubtypeOf(this);
    }

    /** Declared invariants — [] in v1 (no invariant table yet; SPEC-03/04 open Q). */
    getInvariants(): string[]
    {
        return [];
    }

    /** Applied annotations (SPEC-04 Annotation slice on this TypeInfo row). */
    getAnnotations(): AnnotationInfo[]
    {
        const rec = this.rec;
        return this.manifest.annotationsFor(rec.annotStart, rec.annotCount);
    }
}

/** The MemberInfo analog — shared base of FieldInfo and RelationshipInfo. */
export abstract class MemberInfo
{
    abstract readonly name: string;
    abstract readonly token: Token;
    /** AXIS 1. The TypeInfo that DECLARED this member. */
    abstract readonly declaringType: TypeInfo;
    /** The TypeInfo this member was OBTAINED THROUGH (the receiver). */
    abstract readonly reflectedType: TypeInfo;
    abstract getAnnotations(): AnnotationInfo[];
}

/** A scalar field — one that lands in the node's attrs (idea #4). */
export class FieldInfo extends MemberInfo
{
    constructor(
        private readonly manifest: Manifest,
        private readonly row: number,
        readonly declaringType: TypeInfo,
        readonly reflectedType: TypeInfo,
    )
    {
        super();
    }

    private get rec()
    {
        return this.manifest.tables.field(this.row);
    }

    get name(): string
    {
        return this.manifest.tables.getString(this.rec.name);
    }

    get token(): Token
    {
        return Tokens.of(TableId.Field, this.row);
    }

    /** The field's declared value type (a primitive/concept TypeInfo). */
    get fieldType(): TypeInfo | undefined
    {
        return this.manifest.resolveTypeRef(this.rec.type);
    }

    get cardinality(): Cardinality
    {
        return this.rec.card;
    }

    /**
     * The effective scalar value on `node`: node.attrs[name] if present, else the
     * fixed value from node.class (walking broader), else undefined.
     */
    getValue(node: ReflectedNode): Scalar | undefined
    {
        const own = node.attrs[this.name];
        if (own !== undefined) return own;
        if (node.class !== undefined && node.class !== null)
        {
            const term = this.manifest.getTerm(node.class);
            const fixer = term?.findFixing(this);
            if (fixer !== undefined) return fixer.getFixedValue(this);
        }
        return undefined;
    }

    /** Fields have no own graph node, hence no annotation applications. */
    getAnnotations(): AnnotationInfo[]
    {
        return [];
    }
}

/** A reference member — one that materialises as edges (idea #4). PropertyInfo analog. */
export class RelationshipInfo extends MemberInfo
{
    constructor(
        private readonly manifest: Manifest,
        private readonly row: number,
        readonly declaringType: TypeInfo,
        readonly reflectedType: TypeInfo,
    )
    {
        super();
    }

    private get rec()
    {
        return this.manifest.tables.rel(this.row);
    }

    get name(): string
    {
        return this.manifest.tables.getString(this.rec.name);
    }

    get token(): Token
    {
        return Tokens.of(TableId.Rel, this.row);
    }

    /** The allowed target types (Rel → Target slice). */
    get targets(): TypeInfo[]
    {
        const out: TypeInfo[] = [];
        for (const t of this.manifest.tables.targetsOf(this.row))
        {
            const type = this.manifest.resolveTypeRef(t.type);
            if (type !== undefined) out.push(type);
        }
        return out;
    }

    get cardinality(): Cardinality
    {
        return this.rec.card;
    }

    /** The inverse member name on the far side, or null. */
    get inverse(): string | null
    {
        const idx = this.rec.inverse;
        return idx === 0 ? null : this.manifest.tables.getString(idx);
    }

    /** The resolved edge targets of this relationship on `node`. */
    getTargets(node: ReflectedNode): string[]
    {
        return node.refs?.[this.name] ?? [];
    }

    /** Applied annotations (SPEC-04 Annotation slice on this Rel row). */
    getAnnotations(): AnnotationInfo[]
    {
        const rec = this.rec;
        return this.manifest.annotationsFor(rec.annotStart, rec.annotCount);
    }
}

/** A taxonomy term / class — a row in the Class table. The Axis-2 value provider. */
export class TermInfo
{
    constructor(private readonly manifest: Manifest, private readonly row: number) {}

    private get rec()
    {
        return this.manifest.tables.class_(this.row);
    }

    get token(): Token
    {
        return Tokens.of(TableId.Class, this.row);
    }

    /** The term's logical id, e.g. "Components.Surface". */
    get id(): string
    {
        return this.manifest.tables.getString(this.rec.name);
    }

    /** The concept this term is-a class of. */
    get concept(): TypeInfo | undefined
    {
        return this.manifest.resolveTypeRef(this.rec.type);
    }

    /** The taxonomy this term belongs to, or undefined. */
    get taxonomy(): TaxonomyInfo | undefined
    {
        const tax = this.rec.taxonomy;
        return tax === 0 ? undefined : this.manifest.taxonomyAt(tax);
    }

    /** The immediate broader term, or undefined at a root. */
    get broader(): TermInfo | undefined
    {
        const b = this.rec.broader;
        return b === 0 ? undefined : this.manifest.termAt(b);
    }

    /** Immediate narrower terms (reverse of broader). */
    narrower(): TermInfo[]
    {
        const out: TermInfo[] = [];
        for (let r = 1; r <= this.manifest.tables.rowCount(TableId.Class); r++)
        {
            if (this.manifest.tables.class_(r).broader === this.row) out.push(this.manifest.termAt(r));
        }
        return out;
    }

    /** True if this term fixes a value for field `f`. */
    fixes(f: FieldInfo): boolean
    {
        const fieldRow = Tokens.row(f.token);
        for (const fixed of this.manifest.tables.fixedOf(this.row))
            if (fixed.field === fieldRow) return true;
        return false;
    }

    /** The value this term pins for `f`, or undefined. */
    getFixedValue(f: FieldInfo): Scalar | undefined
    {
        const fieldRow = Tokens.row(f.token);
        for (const fixed of this.manifest.tables.fixedOf(this.row))
        {
            if (fixed.field !== fieldRow) continue;
            const v = this.manifest.tables.getConst(fixed.value);
            // Fixed scalar values are always Scalar (bigint/null never occur here).
            return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : undefined;
        }
        return undefined;
    }

    /** The nearest term in this term's broader chain that fixes `f` (incl. self). */
    findFixing(f: FieldInfo): TermInfo | undefined
    {
        let term: TermInfo | undefined = this;
        while (term !== undefined)
        {
            if (term.fixes(f)) return term;
            term = term.broader;
        }
        return undefined;
    }

    /** Applied annotations (SPEC-04 Annotation slice on this Class row). */
    getAnnotations(): AnnotationInfo[]
    {
        const rec = this.rec;
        return this.manifest.annotationsFor(rec.annotStart, rec.annotCount);
    }
}

/** A bounded vocabulary — a row in the Taxonomy table. */
export class TaxonomyInfo
{
    constructor(private readonly manifest: Manifest, private readonly row: number) {}

    get token(): Token
    {
        return Tokens.of(TableId.Taxonomy, this.row);
    }

    get name(): string
    {
        return this.manifest.tables.getString(this.manifest.tables.taxonomy(this.row).name);
    }

    /** The concept(s) this taxonomy represents. */
    represents(): TypeInfo[]
    {
        const out: TypeInfo[] = [];
        for (const t of this.manifest.tables.representsOf(this.row))
        {
            const type = this.manifest.resolveTypeRef(t.type);
            if (type !== undefined) out.push(type);
        }
        return out;
    }

    /** Every term in this taxonomy. */
    getTerms(): TermInfo[]
    {
        const out: TermInfo[] = [];
        for (let r = 1; r <= this.manifest.tables.rowCount(TableId.Class); r++)
        {
            if (this.manifest.tables.class_(r).taxonomy === this.row) out.push(this.manifest.termAt(r));
        }
        return out;
    }

    /** Root terms (no broader within this taxonomy). */
    roots(): TermInfo[]
    {
        return this.getTerms().filter((t) => t.broader === undefined);
    }
}

/** An applied annotation — the CustomAttributeData analog. (v1: never produced.) */
export class AnnotationInfo
{
    constructor(readonly type: TypeInfo, readonly args: ReadonlyMap<string, Scalar>) {}
}

/** The object that answers both provenance axes at the point of use. */
export class InstanceMirror
{
    constructor(private readonly manifest: Manifest, readonly node: ReflectedNode) {}

    /** The node's concept. */
    get type(): TypeInfo
    {
        const type = this.manifest.getType(this.node.type);
        if (type === undefined) throw new Error(`unknown node type: ${this.node.type}`);
        return type;
    }

    /** The node's class/term, or undefined. */
    get class(): TermInfo | undefined
    {
        const cls = this.node.class;
        return cls === undefined || cls === null ? undefined : this.manifest.getTerm(cls);
    }

    /** One FieldView per effective field of `type`. */
    fields(): FieldView[]
    {
        return this.type.getFields().map((f) => new FieldView(this.manifest, this.node, f));
    }

    /** The FieldView for one field by name, or undefined. */
    field(name: string): FieldView | undefined
    {
        const f = this.type.getField(name);
        return f === undefined ? undefined : new FieldView(this.manifest, this.node, f);
    }
}

/** Axis-1 + Axis-2 for one field on one instance. */
export class FieldView
{
    constructor(
        private readonly manifest: Manifest,
        private readonly node: ReflectedNode,
        readonly field: FieldInfo,
    ) {}

    /** The effective value on this instance. */
    get value(): Scalar | undefined
    {
        return this.field.getValue(this.node);
    }

    /** AXIS 1 — where the field was DEFINED. Identity: field.declaringType. */
    get definitionOrigin(): TypeInfo
    {
        return this.field.declaringType;
    }

    /** AXIS 2 — where the VALUE came from: the term that fixes it, or "self". */
    get valueOrigin(): TermInfo | "self"
    {
        const cls = this.node.class;
        if (cls === undefined || cls === null) return "self";
        const term = this.manifest.getTerm(cls);
        const fixer = term?.findFixing(this.field);
        if (fixer === undefined) return "self";
        return fixer.getFixedValue(this.field) === this.field.getValue(this.node) ? fixer : "self";
    }
}
