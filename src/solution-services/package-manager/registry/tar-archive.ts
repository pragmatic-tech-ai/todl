/**
 * `TarArchive` — the uncompressed USTAR half of the registry's tar support, with NO
 * node builtins, so both the node-side sync gzip wrappers (`createTgz` in tar.ts,
 * `TarReader` in tar-reader.ts) and the browser-safe async `WebTgz` share ONE
 * header/block implementation. npm package tarballs are ordinary gzipped USTAR
 * archives with every entry rooted under `package/`; this class is the tar layer
 * only — gzip is the caller's concern.
 */

/** One file to place in the archive. `path` is the full archive path, e.g.
 *  `package/model.json`. */
export interface TarEntry
{
    path: string;
    bytes: Uint8Array;
}

/** One file recovered from a tar archive. `path` is the full archive path,
 *  e.g. `package/model.json`. */
export interface TarFile
{
    path: string;
    bytes: Uint8Array;
}

export class TarArchive
{
    private static readonly Block = 512;
    private static readonly NameLength = 100;
    private static readonly PrefixLength = 155;
    private static readonly SizeOffset = 124;
    private static readonly SizeLength = 12;
    private static readonly PrefixOffset = 345;
    private static readonly ChecksumOffset = 148;
    private static readonly ChecksumLength = 8;
    private static readonly FileMode = 0o644;
    private static readonly RegularFileType = 0x30; // typeflag '0'
    private static readonly Space = 0x20;
    private static readonly Magic = "ustar\0";
    private static readonly Version = "00";
    private static readonly PathSeparator = "/";
    private static readonly FieldTooLongMessage = "tar header field too long: ";
    private static readonly PathTooLongMessage = "tar path too long to split: ";

    private static readonly Encoder = new TextEncoder();
    private static readonly Decoder = new TextDecoder();

    /** Assemble `entries` into an UNCOMPRESSED tar archive (two zero blocks terminate it). */
    public static Pack(entries: readonly TarEntry[]): Uint8Array
    {
        const blocks: Uint8Array[] = [];
        for (const entry of entries)
        {
            blocks.push(TarArchive.Header(entry.path, entry.bytes.length));
            blocks.push(entry.bytes);
            blocks.push(TarArchive.Padding(entry.bytes.length));
        }
        blocks.push(new Uint8Array(TarArchive.Block));
        blocks.push(new Uint8Array(TarArchive.Block));

        const total = blocks.reduce((n, b) => n + b.length, 0);
        const tar = new Uint8Array(total);
        let offset = 0;
        for (const block of blocks)
        {
            tar.set(block, offset);
            offset += block.length;
        }
        return tar;
    }

    /** Walk an UNCOMPRESSED tar archive's 512-byte blocks into its regular-file entries,
     *  in archive order. */
    public static Unpack(tar: Uint8Array): TarFile[]
    {
        const files: TarFile[] = [];
        let offset = 0;
        while (offset + TarArchive.Block <= tar.length)
        {
            const header = tar.subarray(offset, offset + TarArchive.Block);
            if (TarArchive.IsZeroBlock(header)) break; // two zero blocks terminate the archive
            const name = TarArchive.Field(header, 0, TarArchive.NameLength);
            const prefix = TarArchive.Field(header, TarArchive.PrefixOffset, TarArchive.PrefixLength);
            const size = TarArchive.Octal(header, TarArchive.SizeOffset, TarArchive.SizeLength);
            const path = prefix.length > 0 ? `${prefix}${TarArchive.PathSeparator}${name}` : name;
            const start = offset + TarArchive.Block;
            files.push({ path, bytes: tar.subarray(start, start + size) });
            offset = start + TarArchive.RoundUp(size);
        }
        return files;
    }

    /** Build the 512-byte USTAR header for one regular-file entry. */
    private static Header(name: string, size: number): Uint8Array
    {
        const block = new Uint8Array(TarArchive.Block);

        // USTAR splits paths over 100 bytes into a 155-byte prefix + 100-byte name.
        let filename = name;
        let prefix = "";
        if (TarArchive.Encoder.encode(name).length > TarArchive.NameLength)
        {
            const cut = name.lastIndexOf(TarArchive.PathSeparator, TarArchive.NameLength);
            if (cut < 0) throw new Error(`${TarArchive.PathTooLongMessage}${name}`);
            prefix = name.slice(0, cut);
            filename = name.slice(cut + 1);
        }

        TarArchive.Put(block, filename, 0, TarArchive.NameLength);
        TarArchive.Put(block, TarArchive.OctalField(TarArchive.FileMode, 8), 100, 8); // mode
        TarArchive.Put(block, TarArchive.OctalField(0, 8), 108, 8); // uid
        TarArchive.Put(block, TarArchive.OctalField(0, 8), 116, 8); // gid
        TarArchive.Put(block, TarArchive.OctalField(size, TarArchive.SizeLength), TarArchive.SizeOffset, TarArchive.SizeLength);
        TarArchive.Put(block, TarArchive.OctalField(0, 12), 136, 12); // mtime (fixed → deterministic archives)
        for (let i = 0; i < TarArchive.ChecksumLength; i++) block[TarArchive.ChecksumOffset + i] = TarArchive.Space; // checksum placeholder
        block[156] = TarArchive.RegularFileType;
        TarArchive.Put(block, TarArchive.Magic, 257, 6);
        TarArchive.Put(block, TarArchive.Version, 263, 2);
        TarArchive.Put(block, prefix, TarArchive.PrefixOffset, TarArchive.PrefixLength);

        let sum = 0;
        for (let i = 0; i < TarArchive.Block; i++) sum += block[i]!;
        // checksum: 6 octal digits + NUL + space
        TarArchive.Put(block, `${sum.toString(8).padStart(6, "0")}\0 `, TarArchive.ChecksumOffset, TarArchive.ChecksumLength);
        return block;
    }

    private static Put(block: Uint8Array, text: string, offset: number, max: number): void
    {
        const bytes = TarArchive.Encoder.encode(text);
        if (bytes.length > max) throw new Error(`${TarArchive.FieldTooLongMessage}${text}`);
        block.set(bytes, offset);
    }

    /** A fixed-width, null-terminated octal field (npm's numeric header encoding). */
    private static OctalField(value: number, length: number): string
    {
        return `${value.toString(8).padStart(length - 1, "0")}\0`;
    }

    /** Pad a body to the next 512-byte boundary. */
    private static Padding(size: number): Uint8Array
    {
        const remainder = size % TarArchive.Block;
        return remainder === 0 ? new Uint8Array(0) : new Uint8Array(TarArchive.Block - remainder);
    }

    /** Read a fixed-width, null/space-terminated string field from a header block. */
    private static Field(header: Uint8Array, offset: number, length: number): string
    {
        let end = offset;
        const limit = offset + length;
        while (end < limit && header[end] !== 0 && header[end] !== TarArchive.Space) end++;
        return TarArchive.Decoder.decode(header.subarray(offset, end));
    }

    /** Parse a null/space-terminated octal numeric field (tar's size encoding). */
    private static Octal(header: Uint8Array, offset: number, length: number): number
    {
        const text = TarArchive.Field(header, offset, length).trim();
        return text.length === 0 ? 0 : parseInt(text, 8);
    }

    /** Round a body size up to the next 512-byte block boundary. */
    private static RoundUp(size: number): number
    {
        const remainder = size % TarArchive.Block;
        return remainder === 0 ? size : size + (TarArchive.Block - remainder);
    }

    private static IsZeroBlock(header: Uint8Array): boolean
    {
        for (let i = 0; i < TarArchive.Block; i++) if (header[i] !== 0) return false;
        return true;
    }
}
