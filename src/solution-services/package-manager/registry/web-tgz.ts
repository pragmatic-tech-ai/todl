/**
 * `WebTgz` — the browser-safe, async `.tgz` codec: the shared USTAR layout
 * (`TarArchive`) gzipped / gunzipped through the web-standard `CompressionStream` /
 * `DecompressionStream` (available in browsers and Node >= 18), so it loads in a
 * renderer bundle with NO node builtins. The output is an ordinary gzip stream —
 * byte-compatible with what `node:zlib` (and therefore npm) reads — and the node-side
 * sync `createTgz` / `TarReader.read` remain for their existing sync callers.
 */
import { TarArchive, type TarEntry, type TarFile } from "./tar-archive.js";

export class WebTgz
{
    private static readonly GzipFormat = "gzip" as const;

    /** Assemble `entries` into a gzipped tar archive (an npm-style `.tgz`). */
    public static async Create(entries: readonly TarEntry[]): Promise<Uint8Array>
    {
        return WebTgz.Pipe(TarArchive.Pack(entries), new CompressionStream(WebTgz.GzipFormat));
    }

    /** Gunzip a `.tgz` and return every regular-file entry, in archive order. */
    public static async Read(tgz: Uint8Array): Promise<TarFile[]>
    {
        return TarArchive.Unpack(await WebTgz.Pipe(tgz, new DecompressionStream(WebTgz.GzipFormat)));
    }

    // Push `bytes` through a web transform stream and collect its whole output.
    private static async Pipe(
        bytes: Uint8Array,
        transform: CompressionStream | DecompressionStream): Promise<Uint8Array>
    {
        // Enqueue an ArrayBuffer-backed COPY: the web stream types require
        // `Uint8Array<ArrayBuffer>` (not a possibly-shared buffer), and the copy keeps
        // the caller's bytes untouched by the stream.
        const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
            start: (controller) =>
            {
                controller.enqueue(new Uint8Array(bytes));
                controller.close();
            },
        });
        const reader = source.pipeThrough(transform).getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (let next = await reader.read(); !next.done; next = await reader.read())
        {
            chunks.push(next.value);
            total += next.value.length;
        }
        const out = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks)
        {
            out.set(chunk, offset);
            offset += chunk.length;
        }
        return out;
    }
}
