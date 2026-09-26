/**
 * `TarReader` — the node-side, synchronous read side of the registry's tar support,
 * the inverse of `createTgz` (design: todl-app-electron-package-manager §5). Gunzips a fetched
 * npm tarball with `node:zlib` and hands the tar to the browser-safe `TarArchive`
 * (shared with the async `WebTgz`) to walk back into `{ path, bytes }` entries, then interprets a package tarball as an `InstalledPackage`. Kept in
 * the package-manager module (Node-side, `node:zlib`) so tests, the CLI, and the
 * app's main process all share one implementation. A class (workspace OOP rule);
 * the sibling writer `createTgz` predates the rule and is left as-is.
 */
import { gunzipSync } from "node:zlib";
import { TarArchive, type TarFile } from "./tar-archive.js";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import type { TodlPackageMeta } from "../package-json.js";
import type { InstalledPackage } from "../resolve.js";

export type { TarFile } from "./tar-archive.js";

/** The subset of a package.json `TarReader.readPackage` reads. */
interface RawPackageJson
{
  name?: string;
  dependencies?: Record<string, string>;
  todl?: TodlPackageMeta;
}

const decoder = new TextDecoder();

export class TarReader
{
  /** Gunzip `bytes` and return every regular-file entry, in archive order. */
  static read(bytes: Uint8Array): TarFile[]
  {
    return TarArchive.Unpack(gunzipSync(bytes));
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
}
