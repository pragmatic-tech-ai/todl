// The #Strings heap (SPEC-04 §4.1): length-prefixed UTF-8 entries packed
// back-to-back. Index 0 is the reserved empty-string sentinel so `0` means
// "none" uniformly across every Str column. Interning dedupes; a `Str` column
// value is the 0-based entry index.

import { ByteWriter, ByteReader } from "./bytes.js";

export class StringsHeap
{
    private readonly entries: string[] = [""];
    private readonly index = new Map<string, number>([["", 0]]);

    /** Number of entries, including the index-0 empty string. */
    get count(): number
    {
        return this.entries.length;
    }

    /** Serialised byte length. */
    get size(): number
    {
        return this.toBytes().length;
    }

    /** Add `s` (or return its existing index); `""` is always 0. */
    intern(s: string): number
    {
        const existing = this.index.get(s);
        if (existing !== undefined) return existing;
        const idx = this.entries.length;
        this.entries.push(s);
        this.index.set(s, idx);
        return idx;
    }

    /** The string at `index` (0 = ""). */
    get(index: number): string
    {
        return this.entries[index];
    }

    /** Pack to `varlen(byteLength) + UTF-8 bytes` per entry, in index order. */
    toBytes(): Uint8Array
    {
        const writer = new ByteWriter();
        const encoder = new TextEncoder();
        for (const entry of this.entries)
        {
            const utf8 = encoder.encode(entry);
            writer.varlenU32(utf8.length);
            writer.bytes(utf8);
        }
        return writer.toUint8Array();
    }

    /** Rebuild a heap from its serialised bytes. */
    static fromBytes(bytes: Uint8Array): StringsHeap
    {
        const heap = new StringsHeap();
        const reader = new ByteReader(bytes);
        const decoder = new TextDecoder();
        // Entry 0 (the "" sentinel) is present on the wire too; re-read all
        // entries from scratch so a heap that only holds "" round-trips.
        heap.entries.length = 0;
        heap.index.clear();
        while (reader.position < bytes.length)
        {
            const len = reader.varlenU32();
            const s = decoder.decode(reader.bytes(len));
            heap.index.set(s, heap.entries.length);
            heap.entries.push(s);
        }
        return heap;
    }
}
