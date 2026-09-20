/**
 * `PackageRegistryClient` — the rich, per-connection package surface built over an
 * {@link IPackageRegistry} (design: package-registry subsystem). It owns everything
 * above the raw registry protocol: listing, version/kind queries, fetching package
 * content/sources, resolving a published dependency closure, publishing an
 * already-compiled directory, and downloading a tarball — speaking only in the
 * abstraction's PascalCase surface, so any backend (HTTP npm, a local directory, …)
 * plugs in unchanged. It never reads a project directory to COMPILE and never
 * invokes the compiler — that is `PackageCompiler`'s / `ProjectInstaller`'s job.
 *
 * `PackageManager` is the backward-compatible subclass that builds this over an
 * HTTP npm backend from an `NpmRegistryConfig` (the shape existing CLI / host
 * consumers construct).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { TarReader } from "./registry/tar-reader.js";
import { createTgz, type TarEntry } from "./registry/tar.js";
import { resolveClosure, type InstalledPackage, type ResolvedClosure } from "./resolve.js";
import { LocalPackageStore } from "./local-package-store.js";
import { PackageManifestBridge } from "./package-manifest-bridge.js";
import {
  type IPackageRegistry,
  type PackageRef,
  type VersionList,
  type PackageManifestJson,
  type PublishablePackage,
} from "./engine/package-registry.js";
import type { PackageDocument } from "../../publish/publish.js";
import type { ResolvedPackage, PackageRef as DomainPackageRef } from "../../domain/domain.js";

/** One authored source file recovered from a published package tarball. */
export interface PackageSource
{
  name: string; // path under package/src/
  text: string;
}

/** Everything a published package's tarball carries, in one round-trip: authored
 *  sources, the npm manifest, the parsed meta + compiled model, the raw model
 *  file, and (from the packument) the declared deps + published versions. Every
 *  field is a plain string / string[] so it crosses the IPC boundary unchanged. */
export interface PackageContents
{
  files: PackageSource[];     // package/src/**
  resources: PackageSource[]; // package/resources/** (mural resources, docs, …)
  packageJson: string;        // package/package.json (pretty-printed)
  metadata: string;           // the `todl` meta block (pretty JSON)
  compiled: string;           // the parsed model document (pretty JSON)
  rawModel: string;           // package/model.json, exactly as published
  dependencies: string[];     // declared dependency names
  versions: string[];         // all published versions
  latest: string;             // the `latest` dist-tag (or "")
}

const SRC_PREFIX = "package/src/";
const RES_PREFIX = "package/resources/";
const PACKAGE_PREFIX = "package/";
const decoder = new TextDecoder();

export class PackageRegistryClient
{
  protected readonly registry: IPackageRegistry;
  private readonly localStore: LocalPackageStore | undefined;

  constructor(registry: IPackageRegistry, localStore?: LocalPackageStore)
  {
    this.registry = registry;
    this.localStore = localStore;
  }

  /** Resolve a Domain ref to manifest bytes + deps + seed, local store first.
   *  A locally-compiled package resolves from its full closure (self-contained);
   *  otherwise the published tarball's own-only document is bridged and the
   *  Domain resolves its declared deps deps-first. */
  async resolveResolved(ref: DomainPackageRef): Promise<ResolvedPackage>
  {
    const version = ref.version ?? (await this.resolvedVersions(ref.model)).slice(-1)[0];
    if (version === undefined) throw new Error(`no version available for "${ref.model}"`);
    const local = this.localStore?.get(ref.model, version);
    if (local !== undefined) return PackageManifestBridge.toResolved(local);
    const installed = await this.getPackage({ name: ref.model, version });
    const deps: DomainPackageRef[] = ((installed.document as PackageDocument).dependencies ?? []).map(
      (d) => ({ model: d.id, version: d.version }),
    );
    return PackageManifestBridge.toResolvedDocument(installed.document, ref.model, version, deps);
  }

  /** Versions for an id: the local store unioned with the registry (deduped, sorted). */
  async resolvedVersions(id: string): Promise<string[]>
  {
    const local = this.localStore?.versions(id) ?? [];
    const remote = await this.registry.ListVersions(id).then((v) => v.versions).catch(() => [] as string[]);
    return [...new Set([...remote, ...local])].sort();
  }

  /** Every package name published under the configured org. */
  list(): Promise<string[]>
  {
    return this.registry.ListPackages();
  }

  /** A package's published versions + dist-tags. */
  versions(name: string): Promise<VersionList>
  {
    return this.registry.ListVersions(name);
  }

  /** The package's declared TODL kind, or "" if it carries no todl block. */
  async manifestKind(name: string): Promise<string>
  {
    const manifest = await this.registry.GetManifest({ name });
    const todl = (manifest as PackageManifestJson).todl as { kind?: string } | undefined;
    return todl?.kind ?? "";
  }

  /** Raw tarball bytes for a ref. */
  getContent(ref: PackageRef): Promise<Uint8Array>
  {
    return this.registry.GetContent(ref);
  }

  /** A compiled package parsed from its tarball. Throws if not a TODL package. */
  async getPackage(ref: PackageRef): Promise<InstalledPackage>
  {
    const pkg = TarReader.readPackage(await this.registry.GetContent(ref));
    if (pkg === undefined) throw new Error(`${ref.name} is not a TODL package`);
    return pkg;
  }

  /** The authored src/** of a published package. */
  async getSources(ref: PackageRef): Promise<PackageSource[]>
  {
    return TarReader.read(await this.registry.GetContent(ref))
      .filter((f) => f.path.startsWith(SRC_PREFIX))
      .map((f) => ({ name: f.path.slice(SRC_PREFIX.length), text: decoder.decode(f.bytes) }));
  }

  /** Everything a package's tarball carries, from ONE content fetch (+ one
   *  packument read for the version list): sources, manifest, meta, compiled +
   *  raw model, deps, versions. Backs the app's per-package content tree. */
  async getContents(ref: PackageRef): Promise<PackageContents>
  {
    const bytes = await this.registry.GetContent(ref);
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
      resources: entries
        .filter((f) => f.path.startsWith(RES_PREFIX))
        .map((f) => ({ name: f.path.slice(RES_PREFIX.length), text: decoder.decode(f.bytes) })),
      packageJson: packageJson !== undefined ? PackageRegistryClient.prettyJson(decoder.decode(packageJson)) : "",
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
  async resolveClosure(rootDeps: readonly string[]): Promise<ResolvedClosure>
  {
    const collected: InstalledPackage[] = [];
    const seen = new Set<string>();
    const queue = [...rootDeps];
    while (queue.length > 0)
    {
      const name = queue.shift() as string;
      if (seen.has(name)) continue;
      seen.add(name);
      const pkg = TarReader.readPackage(await this.registry.GetContent({ name }));
      if (pkg === undefined) continue; // a non-TODL npm dependency; ignore
      collected.push(pkg);
      for (const dep of pkg.dependencies) if (!seen.has(dep)) queue.push(dep);
    }
    return resolveClosure(collected, rootDeps);
  }

  /** Publish an ALREADY-compiled package directory: read its files, tar+gzip them
   *  under `package/`, and publish through the registry abstraction (the npm-free
   *  equivalent of `npm publish`). */
  publish(compiledDir: string): Promise<void>
  {
    return this.registry.Publish(PackageRegistryClient.packDir(compiledDir));
  }

  /** Delete a published version from the registry. */
  deleteVersion(name: string, version: string): Promise<void>
  {
    return this.registry.DeleteVersion(name, version);
  }

  /** Download a published tarball. Writes to `outFile`, or a default
   *  `<unscoped-name>-<version|latest>.tgz` in the cwd. Returns the path written. */
  async get(refInput: string, outFile?: string): Promise<string>
  {
    const ref = PackageRegistryClient.parseRef(refInput);
    const bytes = await this.registry.GetContent(ref);
    const file = outFile ?? `${PackageRegistryClient.unscoped(ref.name)}-${ref.version ?? "latest"}.tgz`;
    writeFileSync(file, bytes);
    return file;
  }

  /** Read a packed package directory into a {@link PublishablePackage}: its
   *  package.json is the manifest; every file tar+gzips under `package/`. */
  private static packDir(distDir: string): PublishablePackage
  {
    const files = PackageRegistryClient.readPackageDir(distDir);
    const manifestFile = files.find((f) => f.rel === "package.json");
    if (manifestFile === undefined) throw new Error(`no package.json in ${distDir}`);
    const manifest = JSON.parse(decoder.decode(manifestFile.bytes)) as PackageManifestJson;
    const entries: TarEntry[] = files.map((f) => ({ path: `${PACKAGE_PREFIX}${f.rel}`, bytes: f.bytes }));
    return { Manifest: manifest, Tarball: createTgz(entries) };
  }

  /** Read every file under `dir` recursively, with forward-slash relative paths. */
  private static readPackageDir(dir: string): Array<{ rel: string; bytes: Uint8Array }>
  {
    const out: Array<{ rel: string; bytes: Uint8Array }> = [];
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true }))
      {
        const full = join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else out.push({ rel: relative(dir, full).split("\\").join("/"), bytes: new Uint8Array(readFileSync(full)) });
      }
    };
    walk(dir);
    return out;
  }

  /** Split a `name` or `name@version` ref (scoped names keep their leading `@`). */
  private static parseRef(input: string): PackageRef
  {
    const at = input.lastIndexOf("@");
    if (at > 0) return { name: input.slice(0, at), version: input.slice(at + 1) };
    return { name: input };
  }

  /** The unscoped tail of a package name, for default output filenames. */
  private static unscoped(name: string): string
  {
    const slash = name.indexOf("/");
    return slash < 0 ? name : name.slice(slash + 1);
  }

  /** Re-indent a JSON string for display; passes the text through unchanged if it
   *  does not parse (so a malformed manifest is still shown rather than swallowed). */
  private static prettyJson(text: string): string
  {
    try
    {
      return JSON.stringify(JSON.parse(text), null, 2);
    }
    catch
    {
      return text;
    }
  }
}
