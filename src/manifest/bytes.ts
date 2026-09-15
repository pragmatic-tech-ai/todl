// Low-level byte I/O for the manifest binary format (SPEC-04 §7, §4).
//
// `ByteWriter` accumulates little-endian fixed-width values, raw byte runs,
// ECMA-335 §II.23.2 compressed unsigned integers (`varlen`), and stream
// alignment padding. `ByteReader` is the mirror cursor over a `Uint8Array`.
// Both are used by the heaps and by every table stream.

const VARLEN_1BYTE_MAX = 0x7f; // fits in 1 byte, top bit 0
const VARLEN_2BYTE_MAX = 0x3fff; // fits in 2 bytes, top bits 10
const VARLEN_4BYTE_MAX = 0x1fffffff; // fits in 4 bytes, top bits 110

/** Growable little-endian byte sink. */
export class ByteWriter
{
    private buffer: Uint8Array = new Uint8Array(64);
    private used = 0;

    /** Number of bytes written so far. */
    get length(): number
    {
        return this.used;
    }

    private ensure(extra: number): void
    {
        const need = this.used + extra;
        if (need <= this.buffer.length) return;
        let cap = this.buffer.length * 2;
        while (cap < need) cap *= 2;
        const grown = new Uint8Array(cap);
        grown.set(this.buffer.subarray(0, this.used));
        this.buffer = grown;
    }

    u8(value: number): void
    {
        this.ensure(1);
        this.buffer[this.used++] = value & 0xff;
    }

    u16(value: number): void
    {
        this.ensure(2);
        this.buffer[this.used++] = value & 0xff;
        this.buffer[this.used++] = (value >>> 8) & 0xff;
    }

    u32(value: number): void
    {
        this.ensure(4);
        this.buffer[this.used++] = value & 0xff;
        this.buffer[this.used++] = (value >>> 8) & 0xff;
        this.buffer[this.used++] = (value >>> 16) & 0xff;
        this.buffer[this.used++] = (value >>> 24) & 0xff;
    }

    /** Write an unsigned integer of `width` bytes (1, 2, or 4), little-endian. */
    uint(value: number, width: 1 | 2 | 4): void
    {
        if (width === 1) this.u8(value);
        else if (width === 2) this.u16(value);
        else this.u32(value);
    }

    /** Append raw bytes verbatim. */
    bytes(data: Uint8Array): void
    {
        this.ensure(data.length);
        this.buffer.set(data, this.used);
        this.used += data.length;
    }

    /** ECMA-335 §II.23.2 compressed unsigned integer (big-endian in-word). */
    varlenU32(value: number): void
    {
        if (value < 0 || value > VARLEN_4BYTE_MAX)
            throw new RangeError(`varlen out of range: ${value}`);
        if (value <= VARLEN_1BYTE_MAX)
        {
            this.u8(value);
        }
        else if (value <= VARLEN_2BYTE_MAX)
        {
            this.u8(0x80 | (value >>> 8));
            this.u8(value & 0xff);
        }
        else
        {
            this.u8(0xc0 | (value >>> 24));
            this.u8((value >>> 16) & 0xff);
            this.u8((value >>> 8) & 0xff);
            this.u8(value & 0xff);
        }
    }

    /** Pad with zero bytes up to the next `boundary`-byte multiple. */
    align(boundary: number): void
    {
        const rem = this.used % boundary;
        if (rem === 0) return;
        this.ensure(boundary - rem);
        for (let i = rem; i < boundary; i++) this.buffer[this.used++] = 0;
    }

    /** A copy of the written bytes (length-exact). */
    toUint8Array(): Uint8Array
    {
        return this.buffer.slice(0, this.used);
    }
}

/** Little-endian cursor over a byte buffer. */
export class ByteReader
{
    private pos: number;

    constructor(private readonly data: Uint8Array, offset = 0)
    {
        this.pos = offset;
    }

    /** Current read offset. */
    get position(): number
    {
        return this.pos;
    }

    /** Move the cursor to an absolute offset. */
    seek(offset: number): void
    {
        this.pos = offset;
    }

    u8(): number
    {
        return this.data[this.pos++]!;
    }

    u16(): number
    {
        const v = this.data[this.pos]! | (this.data[this.pos + 1]! << 8);
        this.pos += 2;
        return v & 0xffff;
    }

    u32(): number
    {
        const v =
            (this.data[this.pos]! |
                (this.data[this.pos + 1]! << 8) |
                (this.data[this.pos + 2]! << 16) |
                (this.data[this.pos + 3]! << 24)) >>>
            0;
        this.pos += 4;
        return v;
    }

    /** Read an unsigned integer of `width` bytes (1, 2, or 4), little-endian. */
    uint(width: 1 | 2 | 4): number
    {
        if (width === 1) return this.u8();
        if (width === 2) return this.u16();
        return this.u32();
    }

    /** Read `count` raw bytes as a fresh copy. */
    bytes(count: number): Uint8Array
    {
        const out = this.data.slice(this.pos, this.pos + count);
        this.pos += count;
        return out;
    }

    /** Read an ECMA-335 §II.23.2 compressed unsigned integer. */
    varlenU32(): number
    {
        const b0 = this.u8();
        if ((b0 & 0x80) === 0) return b0;
        if ((b0 & 0xc0) === 0x80)
        {
            const b1 = this.u8();
            return ((b0 & 0x3f) << 8) | b1;
        }
        const b1 = this.u8();
        const b2 = this.u8();
        const b3 = this.u8();
        return (((b0 & 0x1f) << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
    }

    /** Advance the cursor to the next `boundary`-byte multiple. */
    align(boundary: number): void
    {
        const rem = this.pos % boundary;
        if (rem !== 0) this.pos += boundary - rem;
    }
}

/** Raw-bytes ↔ base64, for the JSON debug view's `const[]` (SPEC-04 §8). */
export class Base64
{
    static encode(bytes: Uint8Array): string
    {
        let s = "";
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
        return btoa(s);
    }

    static decode(text: string): Uint8Array
    {
        const s = atob(text);
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
    }
}
