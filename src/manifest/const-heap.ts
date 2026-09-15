// The #Const heap (SPEC-04 §4.2): encoded fixed/default scalar values, one
// blob per entry, packed as `varlen(byteLength) + bytes`. Index 0 is the
// null sentinel (zero-length blob). Each real blob begins with a 1-byte
// ConstTag then its payload; the tag lets us keep bigint (i64) distinct from
// number (f64) on the wire. Extend by adding tags — never renumber.

import { ByteWriter, ByteReader } from "./bytes.js";

/** A scalar the model can pin as a fixed/default value. */
export type ConstValue = null | boolean | bigint | number | string;

enum ConstTag
{
    Null = 0x00,
    Bool = 0x01,
    I64 = 0x02,
    F64 = 0x03,
    Str = 0x04,
}

export class ConstHeap
{
    private readonly blobs: Uint8Array[] = [new Uint8Array(0)];
    private readonly index = new Map<string, number>([["", 0]]);

    /** Number of entries, including the index-0 null sentinel. */
    get count(): number
    {
        return this.blobs.length;
    }

    /** Serialised byte length. */
    get size(): number
    {
        return this.toBytes().length;
    }

    /** Add `value` (or return its existing index); `null` is always 0. */
    intern(value: ConstValue): number
    {
        if (value === null) return 0;
        const blob = ConstHeap.encode(value);
        const key = ConstHeap.keyOf(blob);
        const existing = this.index.get(key);
        if (existing !== undefined) return existing;
        const idx = this.blobs.length;
        this.blobs.push(blob);
        this.index.set(key, idx);
        return idx;
    }

    /** Decode the value at `index` (0 = null). */
    get(index: number): ConstValue
    {
        const blob = this.blobs[index]!;
        if (blob.length === 0) return null;
        return ConstHeap.decode(blob);
    }

    /** Raw blob bytes per entry, in index order (index 0 = empty); copies. */
    toBlobs(): Uint8Array[]
    {
        return this.blobs.map((b) => b.slice());
    }

    /** Pack `varlen(byteLength) + blob` per entry, in index order. */
    toBytes(): Uint8Array
    {
        const writer = new ByteWriter();
        for (const blob of this.blobs)
        {
            writer.varlenU32(blob.length);
            writer.bytes(blob);
        }
        return writer.toUint8Array();
    }

    /** Rebuild a heap from in-order raw blobs (blob 0 must be empty). */
    static fromBlobs(blobs: readonly Uint8Array[]): ConstHeap
    {
        const heap = new ConstHeap();
        heap.blobs.length = 0;
        heap.index.clear();
        for (const blob of blobs)
        {
            const copy = blob.slice();
            heap.index.set(ConstHeap.keyOf(copy), heap.blobs.length);
            heap.blobs.push(copy);
        }
        return heap;
    }

    /** Rebuild a heap from its serialised bytes. */
    static fromBytes(bytes: Uint8Array): ConstHeap
    {
        const heap = new ConstHeap();
        heap.blobs.length = 0;
        heap.index.clear();
        const reader = new ByteReader(bytes);
        while (reader.position < bytes.length)
        {
            const len = reader.varlenU32();
            const blob = reader.bytes(len);
            heap.index.set(ConstHeap.keyOf(blob), heap.blobs.length);
            heap.blobs.push(blob);
        }
        return heap;
    }

    private static encode(value: boolean | bigint | number | string): Uint8Array
    {
        if (typeof value === "boolean")
            return new Uint8Array([ConstTag.Bool, value ? 1 : 0]);
        if (typeof value === "bigint")
        {
            const buf = new Uint8Array(9);
            buf[0] = ConstTag.I64;
            new DataView(buf.buffer).setBigInt64(1, value, true);
            return buf;
        }
        if (typeof value === "number")
        {
            const buf = new Uint8Array(9);
            buf[0] = ConstTag.F64;
            new DataView(buf.buffer).setFloat64(1, value, true);
            return buf;
        }
        const utf8 = new TextEncoder().encode(value);
        const buf = new Uint8Array(1 + utf8.length);
        buf[0] = ConstTag.Str;
        buf.set(utf8, 1);
        return buf;
    }

    private static decode(blob: Uint8Array): ConstValue
    {
        const tag = blob[0] as ConstTag;
        switch (tag)
        {
            case ConstTag.Null:
                return null;
            case ConstTag.Bool:
                return blob[1] === 1;
            case ConstTag.I64:
                return new DataView(blob.buffer, blob.byteOffset).getBigInt64(1, true);
            case ConstTag.F64:
                return new DataView(blob.buffer, blob.byteOffset).getFloat64(1, true);
            case ConstTag.Str:
                return new TextDecoder().decode(blob.subarray(1));
            default:
                throw new RangeError(`unknown ConstTag: ${tag}`);
        }
    }

    private static keyOf(blob: Uint8Array): string
    {
        // Latin1 view of the raw bytes — a cheap, collision-free dedup key.
        let s = "";
        for (let i = 0; i < blob.length; i++) s += String.fromCharCode(blob[i]!);
        return s;
    }
}
