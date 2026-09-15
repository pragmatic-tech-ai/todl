// Index-width flags (SPEC-04 §7.4): the header `reserved` u16 is a flags word
// recording, per widenable index family, whether it was emitted as u16 (bit
// clear) or u32 (bit set). ECMA heap-size-flags analog. A family widens when
// its addressable maximum exceeds 0xFFFF.

import { TableId, HeapId } from "./enums.js";

/** Row/heap sizes needed to decide index widths. */
export interface ManifestCounts
{
    strings: number;
    consts: number;
    typeInfo: number;
    field: number;
    rel: number;
    target: number;
    class: number;
    fixed: number;
    taxonomy: number;
    imports: number;
    typeRef: number;
}

// Flag bit positions (§7.4). Heaps 0..1, table rows 2..10, coded 11.
enum WidthFlag
{
    Strings = 0,
    Const = 1,
    TypeInfoRow = 2,
    FieldRow = 3,
    RelRow = 4,
    TargetRow = 5,
    ClassRow = 6,
    FixedRow = 7,
    TaxonomyRow = 8,
    ImportsRow = 9,
    TypeRefRow = 10,
    Coded = 11,
}

export class IndexWidths
{
    private constructor(readonly reserved: number) {}

    /** Decide widths from final row/heap counts. */
    static fromCounts(c: ManifestCounts): IndexWidths
    {
        let flags = 0;
        const wide = (over: boolean, bit: WidthFlag) => {
            if (over) flags |= 1 << bit;
        };
        wide(c.strings > 0xffff, WidthFlag.Strings);
        wide(c.consts > 0xffff, WidthFlag.Const);
        wide(c.typeInfo > 0xffff, WidthFlag.TypeInfoRow);
        wide(c.field > 0xffff, WidthFlag.FieldRow);
        wide(c.rel > 0xffff, WidthFlag.RelRow);
        wide(c.target > 0xffff, WidthFlag.TargetRow);
        wide(c.class > 0xffff, WidthFlag.ClassRow);
        wide(c.fixed > 0xffff, WidthFlag.FixedRow);
        wide(c.taxonomy > 0xffff, WidthFlag.TaxonomyRow);
        wide(c.imports > 0xffff, WidthFlag.ImportsRow);
        wide(c.typeRef > 0xffff, WidthFlag.TypeRefRow);
        // coded = row*2 + tag; widen when the largest possible coded value
        // over TypeInfo|TypeRef exceeds 0xFFFF.
        const maxRow = Math.max(c.typeInfo, c.typeRef);
        wide(maxRow * 2 + 1 > 0xffff, WidthFlag.Coded);
        return new IndexWidths(flags);
    }

    /** Rebuild widths from a header's `reserved` flags word. */
    static fromFlags(reserved: number): IndexWidths
    {
        return new IndexWidths(reserved & 0xffff);
    }

    private widthOf(bit: WidthFlag): 2 | 4
    {
        return (this.reserved & (1 << bit)) !== 0 ? 4 : 2;
    }

    /** Byte width (2 or 4) of an index into `heap`. */
    heapWidth(heap: HeapId): 2 | 4
    {
        return this.widthOf(heap === HeapId.Strings ? WidthFlag.Strings : WidthFlag.Const);
    }

    /** Byte width (2 or 4) of a plain row index into `table`. */
    rowWidth(table: TableId): 2 | 4
    {
        return this.widthOf(IndexWidths.rowBit(table));
    }

    /** Byte width (2 or 4) of a coded `TypeDefOrRef` column. */
    codedWidth(): 2 | 4
    {
        return this.widthOf(WidthFlag.Coded);
    }

    private static rowBit(table: TableId): WidthFlag
    {
        switch (table)
        {
            case TableId.TypeInfo:
                return WidthFlag.TypeInfoRow;
            case TableId.Field:
                return WidthFlag.FieldRow;
            case TableId.Rel:
                return WidthFlag.RelRow;
            case TableId.Target:
                return WidthFlag.TargetRow;
            case TableId.Class:
                return WidthFlag.ClassRow;
            case TableId.Fixed:
                return WidthFlag.FixedRow;
            case TableId.Taxonomy:
                return WidthFlag.TaxonomyRow;
            case TableId.Imports:
                return WidthFlag.ImportsRow;
            case TableId.TypeRef:
                return WidthFlag.TypeRefRow;
        }
    }
}
