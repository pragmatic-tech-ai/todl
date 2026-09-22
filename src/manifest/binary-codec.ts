// Binary serializer (SPEC-04 §7): the single implementation that packs a
// manifest's heaps + rows into the container. Both ManifestWriter (building
// fresh) and ManifestReader (re-emitting a loaded manifest) delegate here so
// there is exactly one place that lays out the header, directories, and
// width-flagged streams.

import { ByteWriter } from "./bytes.js";
import { StringsHeap } from "./strings-heap.js";
import { ConstHeap } from "./const-heap.js";
import { TableId, HeapId } from "./enums.js";
import { IndexWidths, type ManifestCounts } from "./index-widths.js";
import { ManifestSchema, ColKind } from "./schema.js";

export class BinarySerializer
{
    static serialize(
        model: string,
        version: string,
        root: number,
        strings: StringsHeap,
        consts: ConstHeap,
        rowsOf: (table: TableId) => number[][],
    ): Uint8Array
    {
        // Header stores model/version as #Strings indices; intern (idempotent)
        // before sizing the heap.
        const modelIdx = strings.intern(model);
        const modelVerIdx = strings.intern(version);

        const counts: ManifestCounts = {
            strings: strings.count,
            consts: consts.count,
            typeInfo: rowsOf(TableId.TypeInfo).length,
            field: rowsOf(TableId.Field).length,
            rel: rowsOf(TableId.Rel).length,
            target: rowsOf(TableId.Target).length,
            class: rowsOf(TableId.Class).length,
            fixed: rowsOf(TableId.Fixed).length,
            taxonomy: rowsOf(TableId.Taxonomy).length,
            imports: rowsOf(TableId.Imports).length,
            typeRef: rowsOf(TableId.TypeRef).length,
            annotation: rowsOf(TableId.Annotation).length,
            annotationArg: rowsOf(TableId.AnnotationArg).length,
        };
        const widths = IndexWidths.fromCounts(counts);
        const strBytes = strings.toBytes();
        const constBytes = consts.toBytes();

        // Pack each table stream; capture recordSize + rowCount.
        const streams = new Map<TableId, Uint8Array>();
        const recordSizes = new Map<TableId, number>();
        const rowCounts = new Map<TableId, number>();
        for (const table of ManifestSchema.order)
        {
            const cols = ManifestSchema.columns(table);
            recordSizes.set(table, ManifestSchema.recordSize(table, widths));
            const rows = rowsOf(table);
            rowCounts.set(table, rows.length);
            const tw = new ByteWriter();
            for (const row of rows)
            {
                for (let i = 0; i < cols.length; i++)
                {
                    const col = cols[i]!;
                    const value = row[i]!;
                    if (col.kind === ColKind.U8) tw.u8(value);
                    else if (col.kind === ColKind.U16) tw.u16(value);
                    else tw.uint(value, col.width(widths));
                }
            }
            streams.set(table, tw.toUint8Array());
        }

        const strW = widths.heapWidth(HeapId.Strings);
        const rootW = widths.rowWidth(TableId.TypeInfo);
        const headerSize =
            4 + 2 + 2 + strW + strW + rootW + 1 + 1 +
            ManifestSchema.order.length * ManifestSchema.TABLE_DIR_ENTRY_SIZE +
            2 * ManifestSchema.HEAP_DIR_ENTRY_SIZE;

        // 4-aligned stream offsets.
        const align4 = (n: number) => (n % 4 === 0 ? n : n + (4 - (n % 4)));
        const tableOffset = new Map<TableId, number>();
        let cursor = align4(headerSize);
        for (const table of ManifestSchema.order)
        {
            tableOffset.set(table, cursor);
            cursor = align4(cursor + streams.get(table)!.length);
        }
        const stringsOffset = cursor;
        cursor = align4(cursor + strBytes.length);
        const constOffset = cursor;

        // Header + directories.
        const out = new ByteWriter();
        out.u32(ManifestSchema.MAGIC);
        out.u16(ManifestSchema.FORMAT_VERSION);
        out.u16(widths.reserved);
        out.uint(modelIdx, strW);
        out.uint(modelVerIdx, strW);
        out.uint(root, rootW);
        out.u8(ManifestSchema.order.length);
        out.u8(2);
        for (const table of ManifestSchema.order)
        {
            out.u8(table);
            out.u16(recordSizes.get(table)!);
            out.u32(rowCounts.get(table)!);
            out.u32(tableOffset.get(table)!);
        }
        out.u8(HeapId.Strings);
        out.u32(stringsOffset);
        out.u32(strBytes.length);
        out.u8(HeapId.Const);
        out.u32(constOffset);
        out.u32(constBytes.length);

        // Aligned streams in directory order, then heaps.
        out.align(4);
        for (const table of ManifestSchema.order)
        {
            out.bytes(streams.get(table)!);
            out.align(4);
        }
        out.bytes(strBytes);
        out.align(4);
        out.bytes(constBytes);
        return out.toUint8Array();
    }
}
