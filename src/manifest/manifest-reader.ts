// ManifestReader (SPEC-04 §9.3): parses the binary container back into heaps
// and decoded row arrays, and re-emits the JSON debug view for round-trip
// verification. Row decoding is positional against the shared ManifestSchema,
// so the reader can never drift from the writer's column order.

import { ByteReader, Base64 } from "./bytes.js";
import { StringsHeap } from "./strings-heap.js";
import { ConstHeap, type ConstValue } from "./const-heap.js";
import { TableId, HeapId } from "./enums.js";
import { Token, TypeDefOrRef } from "./token.js";
import { IndexWidths } from "./index-widths.js";
import { ManifestSchema, ColKind } from "./schema.js";
import type {
    TypeInfoRec, FieldRec, RelRec, TargetRec, ClassRec,
    FixedRec, TaxonomyRec, ImportsRec, TypeRefRec, ManifestJson,
} from "./records.js";

export class ManifestReader
{
    private constructor(
        readonly model: string,
        readonly version: string,
        readonly formatVersion: number,
        private readonly rootRow: number,
        private readonly strings: StringsHeap,
        private readonly consts: ConstHeap,
        private readonly tables: Map<TableId, number[][]>,
    ) {}

    /** Root TypeInfo token (or Token.Null). */
    get root(): Token
    {
        return new Token(TableId.TypeInfo, this.rootRow);
    }

    static fromBinary(bytes: Uint8Array): ManifestReader
    {
        const r = new ByteReader(bytes);
        const magic = r.u32();
        if (magic !== ManifestSchema.MAGIC)
            throw new Error(`bad manifest magic: 0x${magic.toString(16)}`);
        const formatVersion = r.u16();
        const reserved = r.u16();
        const widths = IndexWidths.fromFlags(reserved);
        const strW = widths.heapWidth(HeapId.Strings);
        const modelIdx = r.uint(strW);
        const modelVerIdx = r.uint(strW);
        const rootRow = r.uint(widths.rowWidth(TableId.TypeInfo));
        const tableCount = r.u8();
        const heapCount = r.u8();

        const tableDir = new Map<number, { recordSize: number; rowCount: number; offset: number }>();
        for (let i = 0; i < tableCount; i++)
        {
            const id = r.u8();
            const recordSize = r.u16();
            const rowCount = r.u32();
            const offset = r.u32();
            tableDir.set(id, { recordSize, rowCount, offset });
        }
        const heapDir = new Map<number, { offset: number; size: number }>();
        for (let i = 0; i < heapCount; i++)
        {
            const id = r.u8();
            const offset = r.u32();
            const size = r.u32();
            heapDir.set(id, { offset, size });
        }

        // Heaps.
        const strEntry = heapDir.get(HeapId.Strings)!;
        const constEntry = heapDir.get(HeapId.Const)!;
        const strings = StringsHeap.fromBytes(bytes.subarray(strEntry.offset, strEntry.offset + strEntry.size));
        const consts = ConstHeap.fromBytes(bytes.subarray(constEntry.offset, constEntry.offset + constEntry.size));

        // Table rows (positional decode against the schema).
        const tables = new Map<TableId, number[][]>();
        for (const table of ManifestSchema.order)
        {
            const dir = tableDir.get(table)!;
            const cols = ManifestSchema.columns(table);
            const rows: number[][] = [];
            for (let row = 0; row < dir.rowCount; row++)
            {
                r.seek(dir.offset + row * dir.recordSize);
                const values: number[] = [];
                for (const col of cols)
                {
                    if (col.kind === ColKind.U8) values.push(r.u8());
                    else if (col.kind === ColKind.U16) values.push(r.u16());
                    else values.push(r.uint(col.width(widths)));
                }
                rows.push(values);
            }
            tables.set(table, rows);
        }

        return new ManifestReader(
            strings.get(modelIdx), strings.get(modelVerIdx),
            formatVersion, rootRow, strings, consts, tables,
        );
    }

    /** Number of real rows in `table`. */
    rowCount(table: TableId): number
    {
        return this.tables.get(table)!.length;
    }

    /** Number of entries (incl. index 0) in `heap`. */
    heapSize(heap: HeapId): number
    {
        return heap === HeapId.Strings ? this.strings.count : this.consts.count;
    }

    getString(index: number): string
    {
        return this.strings.get(index);
    }

    getConst(index: number): ConstValue
    {
        return this.consts.get(index);
    }

    /** Decode a coded TypeDefOrRef (§6). */
    decodeTypeRef(coded: number): TypeDefOrRef
    {
        return TypeDefOrRef.decode(coded);
    }

    private row(table: TableId, row: number): number[]
    {
        if (row < 1) throw new RangeError(`row 0 is the null slot in ${TableId[table]}`);
        const rows = this.tables.get(table)!;
        const values = rows[row - 1];
        if (values === undefined) throw new RangeError(`${TableId[table]} row ${row} out of range`);
        return values;
    }

    typeInfo(row: number): TypeInfoRec
    {
        const v = this.row(TableId.TypeInfo, row);
        return {
            name: v[0]!, ns: v[1]!, kind: v[2]!, extends: v[3]!,
            fieldStart: v[4]!, fieldCount: v[5]!, relStart: v[6]!, relCount: v[7]!,
        };
    }

    field(row: number): FieldRec
    {
        const v = this.row(TableId.Field, row);
        return { name: v[0]!, type: v[1]!, card: v[2]! };
    }

    rel(row: number): RelRec
    {
        const v = this.row(TableId.Rel, row);
        return { name: v[0]!, targetStart: v[1]!, targetCount: v[2]!, card: v[3]!, inverse: v[4]! };
    }

    target(row: number): TargetRec
    {
        const v = this.row(TableId.Target, row);
        return { type: v[0]! };
    }

    class_(row: number): ClassRec
    {
        const v = this.row(TableId.Class, row);
        return {
            name: v[0]!, type: v[1]!, taxonomy: v[2]!, broader: v[3]!,
            fixedStart: v[4]!, fixedCount: v[5]!,
        };
    }

    fixed(row: number): FixedRec
    {
        const v = this.row(TableId.Fixed, row);
        return { field: v[0]!, value: v[1]! };
    }

    taxonomy(row: number): TaxonomyRec
    {
        const v = this.row(TableId.Taxonomy, row);
        return { name: v[0]!, representsStart: v[1]!, representsCount: v[2]! };
    }

    import_(row: number): ImportsRec
    {
        const v = this.row(TableId.Imports, row);
        return { model: v[0]!, version: v[1]! };
    }

    typeRef(row: number): TypeRefRec
    {
        const v = this.row(TableId.TypeRef, row);
        return { import: v[0]!, name: v[1]! };
    }

    /** Re-emit the JSON debug view (§8) — the round-trip seam. */
    toJSON(): ManifestJson
    {
        const t = (table: TableId) => this.tables.get(table)!.map((r) => r.slice());
        return {
            format: "todl-manifest/1",
            model: this.model,
            version: this.version,
            root: this.rootRow,
            strings: this.strings.toArray(),
            const: this.consts.toBlobs().map((b) => Base64.encode(b)),
            tables: {
                TypeInfo: t(TableId.TypeInfo),
                Field: t(TableId.Field),
                Rel: t(TableId.Rel),
                Target: t(TableId.Target),
                Class: t(TableId.Class),
                Fixed: t(TableId.Fixed),
                Taxonomy: t(TableId.Taxonomy),
                Imports: t(TableId.Imports),
                TypeRef: t(TableId.TypeRef),
            },
        };
    }
}
