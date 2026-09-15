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
import { TableId } from "./enums.js";
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
        }
    }
}
