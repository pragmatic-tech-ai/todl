// ManifestWriter (SPEC-04 §9.2): builds heaps + tables incrementally, then
// serialises to the binary container (§7) or the JSON debug view (§8).
//
// It is a PURE PACKER: callers intern their own strings/consts and pass
// already-interned indices in the `*Rec` records. Slice columns
// (`fieldStart/Count`, `targetStart/Count`, `fixedStart/Count`,
// `representsStart/Count`) are the caller's responsibility — add the member
// rows contiguously, capture `[start, count]`, then add the owning row.

import { StringsHeap } from "./strings-heap.js";
import { ConstHeap, type ConstValue } from "./const-heap.js";
import { Base64 } from "./bytes.js";
import { TableId, MetaKind } from "./enums.js";
import { TypeDefOrRef } from "./token.js";
import { BinarySerializer } from "./binary-codec.js";
import { CardinalityGlyph, ManifestModel, type LogicalManifest, type AnnotationApp, type Scalar } from "./logical.js";
import type {
    TypeInfoRec,
    FieldRec,
    RelRec,
    TargetRec,
    ClassRec,
    FixedRec,
    TaxonomyRec,
    ImportsRec,
    TypeRefRec,
    AnnotationRec,
    AnnotationArgRec,
    ManifestJson,
} from "./records.js";

export class ManifestWriter
{
    private readonly strings = new StringsHeap();
    private readonly consts = new ConstHeap();

    private readonly typeInfos: TypeInfoRec[] = [];
    private readonly fields: FieldRec[] = [];
    private readonly rels: RelRec[] = [];
    private readonly targets: TargetRec[] = [];
    private readonly classes: ClassRec[] = [];
    private readonly fixeds: FixedRec[] = [];
    private readonly taxonomies: TaxonomyRec[] = [];
    private readonly imports: ImportsRec[] = [];
    private readonly typeRefs: TypeRefRec[] = [];
    private readonly annotations: AnnotationRec[] = [];
    private readonly annotationArgs: AnnotationArgRec[] = [];

    private rootRow = 0;

    constructor(readonly model: string, readonly version: string) {}

    /** Root TypeInfo row (0 = none). */
    get root(): number
    {
        return this.rootRow;
    }

    // ---- heap interning (idempotent; 0 for "" / null) ----

    internString(s: string): number
    {
        return this.strings.intern(s);
    }

    internConst(value: ConstValue): number
    {
        return this.consts.intern(value);
    }

    // ---- row appenders (return 1-based row) ----

    addTypeInfo(rec: TypeInfoRec): number
    {
        this.typeInfos.push(rec);
        return this.typeInfos.length;
    }

    addField(rec: FieldRec): number
    {
        this.fields.push(rec);
        return this.fields.length;
    }

    addRel(rec: RelRec): number
    {
        this.rels.push(rec);
        return this.rels.length;
    }

    addTarget(rec: TargetRec): number
    {
        this.targets.push(rec);
        return this.targets.length;
    }

    addClass(rec: ClassRec): number
    {
        this.classes.push(rec);
        return this.classes.length;
    }

    addFixed(rec: FixedRec): number
    {
        this.fixeds.push(rec);
        return this.fixeds.length;
    }

    addTaxonomy(rec: TaxonomyRec): number
    {
        this.taxonomies.push(rec);
        return this.taxonomies.length;
    }

    addImport(rec: ImportsRec): number
    {
        this.imports.push(rec);
        return this.imports.length;
    }

    addTypeRef(rec: TypeRefRec): number
    {
        this.typeRefs.push(rec);
        return this.typeRefs.length;
    }

    addAnnotation(rec: AnnotationRec): number
    {
        this.annotations.push(rec);
        return this.annotations.length;
    }

    addAnnotationArg(rec: AnnotationArgRec): number
    {
        this.annotationArgs.push(rec);
        return this.annotationArgs.length;
    }

    setRoot(typeInfoRow: number): void
    {
        this.rootRow = typeInfoRow;
    }

    /** Number of real rows in `table` (excludes the notional null row 0). */
    rowCount(table: TableId): number
    {
        switch (table)
        {
            case TableId.TypeInfo:
                return this.typeInfos.length;
            case TableId.Field:
                return this.fields.length;
            case TableId.Rel:
                return this.rels.length;
            case TableId.Target:
                return this.targets.length;
            case TableId.Class:
                return this.classes.length;
            case TableId.Fixed:
                return this.fixeds.length;
            case TableId.Taxonomy:
                return this.taxonomies.length;
            case TableId.Imports:
                return this.imports.length;
            case TableId.TypeRef:
                return this.typeRefs.length;
            case TableId.Annotation:
                return this.annotations.length;
            case TableId.AnnotationArg:
                return this.annotationArgs.length;
        }
    }

    /** Rows of `table` as arrays of column values in binary column order (§8). */
    private rowsOf(table: TableId): number[][]
    {
        switch (table)
        {
            case TableId.TypeInfo:
                return this.typeInfos.map((r) => [
                    r.name, r.ns, r.kind, r.extends,
                    r.fieldStart, r.fieldCount, r.relStart, r.relCount,
                    r.annotStart, r.annotCount,
                ]);
            case TableId.Field:
                return this.fields.map((r) => [r.name, r.type, r.card]);
            case TableId.Rel:
                return this.rels.map((r) => [
                    r.name, r.targetStart, r.targetCount, r.card, r.inverse,
                    r.annotStart, r.annotCount,
                ]);
            case TableId.Target:
                return this.targets.map((r) => [r.type]);
            case TableId.Class:
                return this.classes.map((r) => [
                    r.name, r.type, r.taxonomy, r.broader, r.fixedStart, r.fixedCount,
                    r.annotStart, r.annotCount,
                ]);
            case TableId.Fixed:
                return this.fixeds.map((r) => [r.field, r.value]);
            case TableId.Taxonomy:
                return this.taxonomies.map((r) => [
                    r.name, r.representsStart, r.representsCount,
                ]);
            case TableId.Imports:
                return this.imports.map((r) => [r.model, r.version]);
            case TableId.TypeRef:
                return this.typeRefs.map((r) => [r.import, r.name]);
            case TableId.Annotation:
                return this.annotations.map((r) => [r.annotation, r.argStart, r.argCount]);
            case TableId.AnnotationArg:
                return this.annotationArgs.map((r) => [r.name, r.value]);
        }
    }

    /**
     * The JSON debug view (§8): a positional 1:1 mirror — same column order,
     * same numeric indices as the binary. Never shipped; round-trip only.
     */
    toJSON(): ManifestJson
    {
        return {
            format: "todl-manifest/1",
            model: this.model,
            version: this.version,
            root: this.rootRow,
            strings: this.strings.toArray(),
            const: this.consts.toBlobs().map((b) => Base64.encode(b)),
            tables: {
                TypeInfo: this.rowsOf(TableId.TypeInfo),
                Field: this.rowsOf(TableId.Field),
                Rel: this.rowsOf(TableId.Rel),
                Target: this.rowsOf(TableId.Target),
                Class: this.rowsOf(TableId.Class),
                Fixed: this.rowsOf(TableId.Fixed),
                Taxonomy: this.rowsOf(TableId.Taxonomy),
                Imports: this.rowsOf(TableId.Imports),
                TypeRef: this.rowsOf(TableId.TypeRef),
                Annotation: this.rowsOf(TableId.Annotation),
                AnnotationArg: this.rowsOf(TableId.AnnotationArg),
            },
        };
    }

    /** Serialise to the shipped binary container (SPEC-04 §7). */
    toBinary(): Uint8Array
    {
        return BinarySerializer.serialize(
            this.model, this.version, this.rootRow,
            this.strings, this.consts, (table) => this.rowsOf(table),
        );
    }

    /**
     * Lower a SPEC-03 logical manifest into binary tables (SPEC-04 §9.2). The
     * bridge MAPS names → interned indices and coded tokens — it never casts.
     * Concepts become `TypeInfo` rows (kind Concept); any referenced type id
     * that is not a declared concept (a primitive like `string`, or an external
     * name in single-manifest v1) is synthesized as a local `Primitive`
     * `TypeInfo` row, so every coded reference resolves within this manifest.
     * Cross-manifest `Imports`/`TypeRef` lowering is a SPEC-06/Domain concern.
     */
    static fromLogical(m: LogicalManifest): ManifestWriter
    {
        const w = new ManifestWriter(m.model, m.version);
        const model = new ManifestModel(m);
        const conceptIds = Object.keys(m.concepts);

        // Every type id referenced by a coded column, in first-encounter order.
        const referenced: string[] = [];
        const see = (id: string): void => { if (!referenced.includes(id)) referenced.push(id); };
        for (const cid of conceptIds)
        {
            const c = m.concepts[cid]!;
            if (c.extends !== null) see(c.extends);
            for (const f of Object.values(c.fields)) see(f.type);
            for (const r of Object.values(c.relationships)) for (const t of r.targets) see(t);
        }
        for (const cls of Object.values(m.classes)) see(cls.concept);
        for (const tax of Object.values(m.taxonomies)) for (const t of tax.represents) see(t);
        const primitiveIds = referenced.filter((id) => !(id in m.concepts));

        // Annotation type ids applied anywhere (concept / rel / class), in
        // first-encounter order — synthesized as Annotation-kind TypeInfo rows
        // (like primitives) so every coded annotation ref resolves locally.
        const annotationIds: string[] = [];
        // `annotations` is a late addition to the logical sidecar — tolerate its
        // absence in older JSON by treating a missing slice as empty.
        const seeAnnot = (apps: AnnotationApp[] | undefined): void =>
        {
            if (apps === undefined) return;
            for (const a of apps)
                if (!(a.annotation in m.concepts) && !annotationIds.includes(a.annotation)) annotationIds.push(a.annotation);
        };
        for (const c of Object.values(m.concepts))
        {
            seeAnnot(c.annotations);
            for (const r of Object.values(c.relationships)) seeAnnot(r.annotations);
        }
        for (const cls of Object.values(m.classes)) seeAnnot(cls.annotations);

        // Precompute rows so coded references can point forward.
        const typeRow = new Map<string, number>();
        let ti = 0;
        for (const cid of conceptIds) typeRow.set(cid, ++ti);
        for (const pid of primitiveIds) typeRow.set(pid, ++ti);
        for (const aid of annotationIds) if (!typeRow.has(aid)) typeRow.set(aid, ++ti);
        const taxRow = new Map<string, number>();
        let tx = 0;
        for (const tid of Object.keys(m.taxonomies)) taxRow.set(tid, ++tx);
        const classRow = new Map<string, number>();
        let cx = 0;
        for (const clsId of Object.keys(m.classes)) classRow.set(clsId, ++cx);

        const coded = (id: string): number => {
            const r = typeRow.get(id);
            return r === undefined ? 0 : new TypeDefOrRef(false, r).encode();
        };
        const fieldRowOf = new Map<string, number>(); // "concept.field" -> Field row

        // Pack a def's annotations into contiguous Annotation (+ AnnotationArg)
        // rows, returning the parent's [annotStart, annotCount] slice.
        const packAnnotations = (apps: AnnotationApp[] | undefined): [number, number] =>
        {
            if (apps === undefined || apps.length === 0) return [0, 0];
            const annotStart = w.rowCount(TableId.Annotation) + 1;
            for (const app of apps)
            {
                const argEntries = Object.entries(app.args) as [string, Scalar][];
                const argStart = argEntries.length > 0 ? w.rowCount(TableId.AnnotationArg) + 1 : 0;
                for (const [name, value] of argEntries)
                    w.addAnnotationArg({ name: w.internString(name), value: w.internConst(value) });
                w.addAnnotation({ annotation: coded(app.annotation), argStart, argCount: argEntries.length });
            }
            return [annotStart, apps.length];
        };

        // Pass 1: concept TypeInfo rows (+ Field / Rel / Target slices), in order.
        for (const cid of conceptIds)
        {
            const c = m.concepts[cid]!;
            const fieldEntries = Object.entries(c.fields);
            const fieldStart = fieldEntries.length > 0 ? w.rowCount(TableId.Field) + 1 : 0;
            for (const [fname, fdef] of fieldEntries)
            {
                const frow = w.addField({
                    name: w.internString(fname),
                    type: coded(fdef.type),
                    card: CardinalityGlyph.fromGlyph(fdef.card),
                });
                fieldRowOf.set(`${cid}.${fname}`, frow);
            }
            const relEntries = Object.entries(c.relationships);
            const relStart = relEntries.length > 0 ? w.rowCount(TableId.Rel) + 1 : 0;
            for (const [rname, rdef] of relEntries)
            {
                const targetStart = rdef.targets.length > 0 ? w.rowCount(TableId.Target) + 1 : 0;
                for (const t of rdef.targets) w.addTarget({ type: coded(t) });
                const [relAnnotStart, relAnnotCount] = packAnnotations(rdef.annotations);
                w.addRel({
                    name: w.internString(rname),
                    targetStart,
                    targetCount: rdef.targets.length,
                    card: CardinalityGlyph.fromGlyph(rdef.card),
                    inverse: rdef.inverse !== undefined ? w.internString(rdef.inverse) : 0,
                    annotStart: relAnnotStart,
                    annotCount: relAnnotCount,
                });
            }
            const [cAnnotStart, cAnnotCount] = packAnnotations(c.annotations);
            w.addTypeInfo({
                name: w.internString(cid),
                ns: 0,
                kind: MetaKind.Concept,
                extends: c.extends !== null ? coded(c.extends) : 0,
                fieldStart,
                fieldCount: fieldEntries.length,
                relStart,
                relCount: relEntries.length,
                annotStart: cAnnotStart,
                annotCount: cAnnotCount,
            });
        }
        // Synthesized primitive TypeInfo rows (kind Primitive, no members).
        for (const pid of primitiveIds)
        {
            w.addTypeInfo({
                name: w.internString(pid), ns: 0, kind: MetaKind.Primitive,
                extends: 0, fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0,
                annotStart: 0, annotCount: 0,
            });
        }
        // Synthesized annotation-type TypeInfo rows (kind Annotation, no members).
        for (const aid of annotationIds)
        {
            w.addTypeInfo({
                name: w.internString(aid), ns: 0, kind: MetaKind.Annotation,
                extends: 0, fieldStart: 0, fieldCount: 0, relStart: 0, relCount: 0,
                annotStart: 0, annotCount: 0,
            });
        }

        // Pass 2: Taxonomy rows (+ represents Target slices), in order.
        for (const tid of Object.keys(m.taxonomies))
        {
            const tax = m.taxonomies[tid]!;
            const representsStart = tax.represents.length > 0 ? w.rowCount(TableId.Target) + 1 : 0;
            for (const t of tax.represents) w.addTarget({ type: coded(t) });
            w.addTaxonomy({
                name: w.internString(tid),
                representsStart,
                representsCount: tax.represents.length,
            });
        }

        // Pass 3: Class rows (+ Fixed slices), in order.
        for (const clsId of Object.keys(m.classes))
        {
            const cls = m.classes[clsId]!;
            const fixedEntries = Object.entries(cls.fixed);
            const fixedStart = fixedEntries.length > 0 ? w.rowCount(TableId.Fixed) + 1 : 0;
            for (const [fname, value] of fixedEntries)
            {
                const declaring = model.typeOriginOf(cls.concept, fname);
                const fieldRow = declaring !== undefined ? fieldRowOf.get(`${declaring}.${fname}`) ?? 0 : 0;
                w.addFixed({ field: fieldRow, value: w.internConst(value) });
            }
            const [clsAnnotStart, clsAnnotCount] = packAnnotations(cls.annotations);
            w.addClass({
                name: w.internString(clsId),
                type: coded(cls.concept),
                taxonomy: cls.taxonomy !== undefined ? taxRow.get(cls.taxonomy) ?? 0 : 0,
                broader: cls.broader !== undefined ? classRow.get(cls.broader) ?? 0 : 0,
                fixedStart,
                fixedCount: fixedEntries.length,
                annotStart: clsAnnotStart,
                annotCount: clsAnnotCount,
            });
        }

        const rootRow = typeRow.get(m.root);
        if (rootRow !== undefined) w.setRoot(rootRow);
        return w;
    }
}
