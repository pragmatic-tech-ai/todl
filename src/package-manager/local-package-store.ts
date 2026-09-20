import type { CompiledPackage } from "../publish/publish.js";

// An in-memory registry of compiled, not-yet-published packages, keyed by
// `id@version`. Node-free (holds CompiledPackage objects only) so it is safe to
// own from the main process alongside PackageManager. Persists across the
// per-call PackageManager instances the RegistryBridge constructs.
export class LocalPackageStore
{
  private readonly byKey = new Map<string, CompiledPackage>();

  register(pkg: CompiledPackage): void
  {
    this.byKey.set(LocalPackageStore.key(pkg.id, pkg.version), pkg);
  }

  get(id: string, version: string): CompiledPackage | undefined
  {
    return this.byKey.get(LocalPackageStore.key(id, version));
  }

  has(id: string, version: string): boolean
  {
    return this.byKey.has(LocalPackageStore.key(id, version));
  }

  versions(id: string): string[]
  {
    const out: string[] = [];
    for (const pkg of this.byKey.values()) if (pkg.id === id) out.push(pkg.version);
    return out;
  }

  private static key(id: string, version: string): string
  {
    return `${id}@${version}`;
  }
}
