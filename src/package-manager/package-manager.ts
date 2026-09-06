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
}
