// Table column schema (SPEC-04 §5) — the single source of truth for column
// order and per-column width, shared by the writer and reader so they can
// never drift. Each `Column` knows how to size itself given the resolved
// `IndexWidths`; a row on the wire is its columns packed in this order.

import { TableId, HeapId } from "./enums.js";
import { IndexWidths } from "./index-widths.js";

/** How a column's numeric value is packed. */
export enum ColKind
{
    U8 = 1, // fixed 1-byte code (kind, card)
    U16 = 2, // fixed 2-byte count (fieldCount, …)
    Str = 3, // #Strings heap index (width-flagged)
    Const = 4, // #Const heap index (width-flagged)
    Coded = 5, // TypeDefOrRef coded index (width-flagged)
    Row = 6, // 1-based row index into `rowTable` (width-flagged)
}

export class Column
{
    constructor(readonly name: string, readonly kind: ColKind, readonly rowTable?: TableId) {}

    /** Byte width of this column under the resolved widths. */
    width(widths: IndexWidths): 1 | 2 | 4
    {
        switch (this.kind)
        {
            case ColKind.U8:
                return 1;
            case ColKind.U16:
                return 2;
            case ColKind.Str:
                return widths.heapWidth(HeapId.Strings);
            case ColKind.Const:
                return widths.heapWidth(HeapId.Const);
            case ColKind.Coded:
                return widths.codedWidth();
            case ColKind.Row:
                return widths.rowWidth(this.rowTable!);
        }
    }
}

export class ManifestSchema
{
    /** ASCII "TODM" as a little-endian u32 (SPEC-04 §7). */
    static readonly MAGIC = 0x4d444f54;
    /** Container format version this codec reads/writes. */
    static readonly FORMAT_VERSION = 1;
    /** Bytes per TableDirEntry { id:u8, recordSize:u16, rowCount:u32, offset:u32 }. */
    static readonly TABLE_DIR_ENTRY_SIZE = 11;
    /** Bytes per HeapDirEntry { id:u8, offset:u32, size:u32 }. */
    static readonly HEAP_DIR_ENTRY_SIZE = 9;

    /** Stream / directory order (SPEC-04 §7.3). */
    static readonly order: readonly TableId[] = [
        TableId.TypeInfo, TableId.Field, TableId.Rel, TableId.Target,
        TableId.Class, TableId.Fixed, TableId.Taxonomy, TableId.Imports, TableId.TypeRef,
        TableId.Annotation, TableId.AnnotationArg,
    ];

    /** Columns of `table`, in binary column order (matches §8 JSON order). */
    static columns(table: TableId): readonly Column[]
    {
        switch (table)
        {
            case TableId.TypeInfo:
                return [
                    new Column("name", ColKind.Str),
                    new Column("ns", ColKind.Str),
                    new Column("kind", ColKind.U8),
                    new Column("extends", ColKind.Coded),
                    new Column("fieldStart", ColKind.Row, TableId.Field),
                    new Column("fieldCount", ColKind.U16),
                    new Column("relStart", ColKind.Row, TableId.Rel),
                    new Column("relCount", ColKind.U16),
                    new Column("annotStart", ColKind.Row, TableId.Annotation),
                    new Column("annotCount", ColKind.U16),
                ];
            case TableId.Field:
                return [
                    new Column("name", ColKind.Str),
                    new Column("type", ColKind.Coded),
                    new Column("card", ColKind.U8),
                ];
            case TableId.Rel:
                return [
                    new Column("name", ColKind.Str),
                    new Column("targetStart", ColKind.Row, TableId.Target),
                    new Column("targetCount", ColKind.U16),
                    new Column("card", ColKind.U8),
                    new Column("inverse", ColKind.Str),
                    new Column("annotStart", ColKind.Row, TableId.Annotation),
                    new Column("annotCount", ColKind.U16),
                ];
            case TableId.Target:
                return [new Column("type", ColKind.Coded)];
            case TableId.Class:
                return [
                    new Column("name", ColKind.Str),
                    new Column("type", ColKind.Coded),
                    new Column("taxonomy", ColKind.Row, TableId.Taxonomy),
                    new Column("broader", ColKind.Row, TableId.Class),
                    new Column("fixedStart", ColKind.Row, TableId.Fixed),
                    new Column("fixedCount", ColKind.U16),
                    new Column("annotStart", ColKind.Row, TableId.Annotation),
                    new Column("annotCount", ColKind.U16),
                ];
            case TableId.Fixed:
                return [
                    new Column("field", ColKind.Row, TableId.Field),
                    new Column("value", ColKind.Const),
                ];
            case TableId.Taxonomy:
                return [
                    new Column("name", ColKind.Str),
                    new Column("representsStart", ColKind.Row, TableId.Target),
                    new Column("representsCount", ColKind.U16),
                ];
            case TableId.Imports:
                return [
                    new Column("model", ColKind.Str),
                    new Column("version", ColKind.Str),
                ];
            case TableId.TypeRef:
                return [
                    new Column("import", ColKind.Row, TableId.Imports),
                    new Column("name", ColKind.Str),
                ];
            case TableId.Annotation:
                return [
                    new Column("annotation", ColKind.Coded),
                    new Column("argStart", ColKind.Row, TableId.AnnotationArg),
                    new Column("argCount", ColKind.U16),
                ];
            case TableId.AnnotationArg:
                return [
                    new Column("name", ColKind.Str),
                    new Column("value", ColKind.Const),
                ];
        }
    }

    /** Packed byte size of one row of `table` under the resolved widths. */
    static recordSize(table: TableId, widths: IndexWidths): number
    {
        let size = 0;
        for (const col of ManifestSchema.columns(table)) size += col.width(widths);
        return size;
    }
}
