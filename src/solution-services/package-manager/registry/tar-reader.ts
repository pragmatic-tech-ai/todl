/**
 * `TarReader` — the read side of the registry's tar support, the inverse of
 * `createTgz` (design: todl-app-electron-package-manager §5). Gunzips a fetched
 * npm tarball and walks its 512-byte USTAR blocks back into `{ path, bytes }`
 * entries, then interprets a package tarball as an `InstalledPackage`. Kept in
 * the package-manager module (Node-side, `node:zlib`) so tests, the CLI, and the
 * app's main process all share one implementation. A class (workspace OOP rule);
 * the sibling writer `createTgz` predates the rule and is left as-is.
 */
import { gunzipSync } from "node:zlib";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import type { TodlPackageMeta } from "../package-json.js";
import type { InstalledPackage } from "../resolve.js";

/** One file recovered from a tar archive. `path` is the full archive path,
 *  e.g. `package/model.json`. */
export interface TarFile
{
  path: string;
  bytes: Uint8Array;
}

/** The subset of a package.json `TarReader.readPackage` reads. */
interface RawPackageJson
{
  name?: string;
  dependencies?: Record<string, string>;
  todl?: TodlPackageMeta;
}

const BLOCK = 512;
const decoder = new TextDecoder();

export class TarReader
{
  /** Gunzip `bytes` and return every regular-file entry, in archive order. */
  static read(bytes: Uint8Array): TarFile[]
  {
    const tar = gunzipSync(bytes);
    const files: TarFile[] = [];
    let offset = 0;
    while (offset + BLOCK <= tar.length)
    {
      const header = tar.subarray(offset, offset + BLOCK);
      if (TarReader.isZeroBlock(header)) break; // two zero blocks terminate the archive
      const name = TarReader.field(header, 0, 100);
      const prefix = TarReader.field(header, 345, 155);
      const size = TarReader.octal(header, 124, 12);
      const path = prefix.length > 0 ? `${prefix}/${name}` : name;
      const start = offset + BLOCK;
      files.push({ path, bytes: tar.subarray(start, start + size) });
      offset = start + TarReader.roundUp(size);
    }
    return files;
  }

  /** Interpret a package tarball as an `InstalledPackage`, or `undefined` if it is
   *  not a TODL package (no `package/package.json` with a `todl` block + `name`, or
   *  no `package/model.json`) — mirroring the Node loader's `readPackage(dir)`. */
  static readPackage(bytes: Uint8Array): InstalledPackage | undefined
  {
    const byPath = new Map(TarReader.read(bytes).map((f) => [f.path, f.bytes]));
    const packageJson = byPath.get("package/package.json");
    const modelJson = byPath.get("package/model.json");
    if (packageJson === undefined || modelJson === undefined) return undefined;
    const pkg = JSON.parse(decoder.decode(packageJson)) as RawPackageJson;
    if (pkg.todl === undefined || pkg.name === undefined) return undefined;
    return {
      name: pkg.name,
      meta: pkg.todl,
      dependencies: Object.keys(pkg.dependencies ?? {}),
      document: JSON.parse(decoder.decode(modelJson)) as TodlDocument,
    };
  }

  /** Read a fixed-width, null/space-terminated string field from a header block. */
  private static field(header: Uint8Array, offset: number, length: number): string
  {
    let end = offset;
    const limit = offset + length;
    while (end < limit && header[end] !== 0 && header[end] !== 0x20) end++;
    return decoder.decode(header.subarray(offset, end));
  }

  /** Parse a null/space-terminated octal numeric field (tar's size encoding). */
  private static octal(header: Uint8Array, offset: number, length: number): number
  {
    const text = TarReader.field(header, offset, length).trim();
    return text.length === 0 ? 0 : parseInt(text, 8);
  }

  /** Round a body size up to the next 512-byte block boundary. */
  private static roundUp(size: number): number
  {
    const remainder = size % BLOCK;
    return remainder === 0 ? size : size + (BLOCK - remainder);
  }

  private static isZeroBlock(header: Uint8Array): boolean
  {
    for (let i = 0; i < BLOCK; i++) if (header[i] !== 0) return false;
    return true;
  }
}
