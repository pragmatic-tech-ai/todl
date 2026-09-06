/**
 * Resolve a manifest's declared dependencies (transitively) into ordered base
 * documents (design: package-compiler §3.3). Installed packages (node_modules)
 * are used first; anything not installed is fetched from the registry. The
 * `BaseResolver` seam lets `PackageCompiler` inject a fake in tests.
 */
import { join } from "node:path";
import type { TodlDocument } from "../emit/json.js";
import type { ProjectManifest } from "./manifest.js";
import { readInstalledPackages } from "./node-loader.js";
import { resolveClosure, dependencyNames, type InstalledPackage } from "./resolve.js";
import { NpmRegistry } from "./registry/npm-registry.js";
import { TarReader } from "./registry/tar-reader.js";
import { resolveRegistryConfig } from "./registry/config.js";

/** Resolves declared deps into ordered base documents (deps-first). */
export interface BaseResolver {
  resolve(directory: string, manifest: ProjectManifest, scope: string): Promise<readonly TodlDocument[]>;
}

/** Builds the registry client for a project dir + scope. `undefined` → offline. */
export type RegistryFactory = (directory: string, scope: string) => NpmRegistry | undefined;

export class RegistryBaseResolver implements BaseResolver {
  constructor(private readonly registryFor: RegistryFactory = RegistryBaseResolver.defaultRegistry) {}

  /** Default: a client configured from the project's layered registry config. */
  private static defaultRegistry(directory: string, scope: string): NpmRegistry {
    return new NpmRegistry(resolveRegistryConfig(directory, { scope }, process.env));
  }

  async resolve(directory: string, manifest: ProjectManifest, scope: string): Promise<readonly TodlDocument[]> {
    const installed = new Map<string, InstalledPackage>();
    for (const pkg of readInstalledPackages(join(directory, "node_modules"))) installed.set(pkg.name, pkg);

    const registry = this.registryFor(directory, scope);
    const roots = dependencyNames(manifest, scope);
    const collected: InstalledPackage[] = [];
    const seen = new Set<string>();
    const queue = [...roots];
    while (queue.length > 0) {
      const name = queue.shift() as string;
      if (seen.has(name)) continue;
      seen.add(name);
      let pkg = installed.get(name);
      if (pkg === undefined) {
        pkg = registry === undefined ? undefined : await RegistryBaseResolver.fetch(registry, name);
        if (pkg === undefined) {
          throw new Error(`cannot resolve dependency "${name}" (not installed, not on the registry)`);
        }
      }
      collected.push(pkg);
      for (const dep of pkg.dependencies) if (!seen.has(dep)) queue.push(dep);
    }

    const closure = resolveClosure(collected, roots);
    return [...closure.metaModels, ...closure.libraries];
  }

  /** Fetch + read a package's tarball; `undefined` if absent or not a TODL package. */
  private static async fetch(registry: NpmRegistry, name: string): Promise<InstalledPackage | undefined> {
    try {
      return TarReader.readPackage(await registry.getContent({ name }));
    } catch {
      return undefined; // 404 / transport failure → treated as unresolvable by the caller
    }
  }
}
