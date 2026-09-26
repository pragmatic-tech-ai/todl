/**
 * The node-side, synchronous tar+gzip writer for the registry client (design:
 * todl-package-manager, registry client). The USTAR layout lives in the browser-safe
 * `TarArchive`; this wrapper only gzips it with `node:zlib`, for the sync node callers
 * (`NpmRegistry.publishDir`, `PackageRegistryClient.publish`, the CLI). Browser-safe
 * async callers use `WebTgz.Create` instead — both produce the same npm-style `.tgz`.
 */
import { gzipSync } from "node:zlib";
import { TarArchive, type TarEntry } from "./tar-archive.js";

export type { TarEntry } from "./tar-archive.js";

/** Assemble `entries` into a gzipped tar archive (an npm-style `.tgz`). */
export function createTgz(entries: readonly TarEntry[]): Uint8Array
{
    return gzipSync(TarArchive.Pack(entries));
}
