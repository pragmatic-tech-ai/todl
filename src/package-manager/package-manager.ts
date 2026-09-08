/**
 * `PackageManager` — the registry-facing package surface as one class (design:
 * package-manager). It owns an `NpmRegistry` and speaks only in registry refs,
 * compiled packages, and published packages: listing, version/kind queries,
 * fetching package content/sources, resolving a published dependency closure,
 * publishing an already-compiled directory, and downloading a tarball. It never
 * reads a project directory and never invokes the compiler — that is
 * `PackageCompiler`'s (and `ProjectInstaller`'s) territory.
 */
import { writeFileSync } from "node:fs";
import { NpmRegistry, type NpmRegistryConfig, type PackageRef, type VersionList } from "./registry/npm-registry.js";
import { TarReader } from "./registry/tar-reader.js";
import { resolveClosure, type InstalledPackage, type ResolvedClosure } from "./resolve.js";

/** One authored source file recovered from a published package tarball. */
export interface PackageSource {
  name: string; // path under package/src/
  text: string;
}

/** Everything a published package's tarball carries, in one round-trip: authored
 *  sources, the npm manifest, the parsed meta + compiled model, the raw model
 *  file, and (from the packument) the declared deps + published versions. Every
 *  field is a plain string / string[] so it crosses the IPC boundary unchanged. */
export interface PackageContents {
  files: PackageSource[];   // package/src/**
  packageJson: string;      // package/package.json (pretty-printed)
  metadata: string;         // the `todl` meta block (pretty JSON)
  compiled: string;         // the parsed model document (pretty JSON)
  rawModel: string;         // package/model.json, exactly as published
  dependencies: string[];   // declared dependency names
  versions: string[];       // all published versions
  latest: string;           // the `latest` dist-tag (or "")
}

const SRC_PREFIX = "package/src/";
const decoder = new TextDecoder();

export class PackageManager {
  private readonly registry: NpmRegistry;

  constructor(config: NpmRegistryConfig) {
    this.registry = new NpmRegistry(config);
  }

  /** Every package name published under the configured org. */
  list(): Promise<string[]> {
    return this.registry.listPackages();
  }

  /** A package's published versions + dist-tags. */
  versions(name: string): Promise<VersionList> {
    return this.registry.listVersions(name);
  }

  /** The package's declared TODL kind, or "" if it carries no todl block. */
  async manifestKind(name: string): Promise<string> {
    const manifest = await this.registry.getManifest({ name });
    const todl = manifest.todl as { kind?: string } | undefined;
    return todl?.kind ?? "";
  }

  /** Raw tarball bytes for a ref. */
  getContent(ref: PackageRef): Promise<Uint8Array> {
    return this.registry.getContent(ref);
  }

  /** A compiled package parsed from its tarball. Throws if not a TODL package. */
  async getPackage(ref: PackageRef): Promise<InstalledPackage> {
    const pkg = TarReader.readPackage(await this.registry.getContent(ref));
    if (pkg === undefined) throw new Error(`${ref.name} is not a TODL package`);
    return pkg;
  }

  /** The authored src/** of a published package. */
  async getSources(ref: PackageRef): Promise<PackageSource[]> {
    return TarReader.read(await this.registry.getContent(ref))
      .filter((f) => f.path.startsWith(SRC_PREFIX))
      .map((f) => ({ name: f.path.slice(SRC_PREFIX.length), text: decoder.decode(f.bytes) }));
  }

  /** Everything a package's tarball carries, from ONE content fetch (+ one
   *  packument read for the version list): sources, manifest, meta, compiled +
   *  raw model, deps, versions. Backs the app's per-package content tree. */
  async getContents(ref: PackageRef): Promise<PackageContents> {
    const bytes = await this.registry.getContent(ref);
    const entries = TarReader.read(bytes);
    const byPath = new Map(entries.map((f) => [f.path, f.bytes] as const));
    const pkg = TarReader.readPackage(bytes); // undefined for a non-TODL package
    const packageJson = byPath.get("package/package.json");
    const rawModel = byPath.get("package/model.json");
    const vlist = await this.versions(ref.name).catch(() => ({ versions: [], distTags: {} } as VersionList));
    return {
      files: entries
        .filter((f) => f.path.startsWith(SRC_PREFIX))
        .map((f) => ({ name: f.path.slice(SRC_PREFIX.length), text: decoder.decode(f.bytes) })),
      packageJson: packageJson !== undefined ? PackageManager.prettyJson(decoder.decode(packageJson)) : "",
      metadata: pkg !== undefined ? JSON.stringify(pkg.meta, null, 2) : "",
      compiled: pkg !== undefined ? JSON.stringify(pkg.document, null, 2) : "",
      rawModel: rawModel !== undefined ? decoder.decode(rawModel) : "",
      dependencies: pkg !== undefined ? pkg.dependencies : [],
      versions: vlist.versions,
      latest: vlist.distTags["latest"] ?? "",
    };
  }

  /** Registry-only BFS over published packages: fetch each root dep and its
   *  transitive TODL deps, then resolve the closure deps-first. Non-TODL deps
   *  are ignored (a failed tarball fetch propagates). */
  async resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure> {
    const collected: InstalledPackage[] = [];
    const seen = new Set<string>();
    const queue = [...rootDeps];
    while (queue.length > 0) {
      const name = queue.shift() as string;
      if (seen.has(name)) continue;
      seen.add(name);
      const pkg = TarReader.readPackage(await this.registry.getContent({ name }));
      if (pkg === undefined) continue; // a non-TODL npm dependency; ignore
      collected.push(pkg);
      for (const dep of pkg.dependencies) if (!seen.has(dep)) queue.push(dep);
    }
    return resolveClosure(collected, rootDeps);
  }

  /** Publish an ALREADY-compiled package directory (registry PUT). */
  publish(compiledDir: string): Promise<void> {
    return this.registry.publishDir(compiledDir);
  }

  /** Download a published tarball. Writes to `outFile`, or a default
   *  `<unscoped-name>-<version|latest>.tgz` in the cwd. Returns the path written. */
  async get(refInput: string, outFile?: string): Promise<string> {
    const ref = PackageManager.parseRef(refInput);
    const bytes = await this.registry.getContent(ref);
    const file = outFile ?? `${PackageManager.unscoped(ref.name)}-${ref.version ?? "latest"}.tgz`;
    writeFileSync(file, bytes);
    return file;
  }

  /** Split a `name` or `name@version` ref (scoped names keep their leading `@`). */
  private static parseRef(input: string): PackageRef {
    const at = input.lastIndexOf("@");
    if (at > 0) return { name: input.slice(0, at), version: input.slice(at + 1) };
    return { name: input };
  }

  /** The unscoped tail of a package name, for default output filenames. */
  private static unscoped(name: string): string {
    const slash = name.indexOf("/");
    return slash < 0 ? name : name.slice(slash + 1);
  }

  /** Re-indent a JSON string for display; passes the text through unchanged if it
   *  does not parse (so a malformed manifest is still shown rather than swallowed). */
  private static prettyJson(text: string): string {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
}
