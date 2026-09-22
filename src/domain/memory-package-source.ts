import { Domain, type PackageSource, type PackageRef, type ResolvedPackage } from "./domain.js";

// An in-memory PackageSource: a map of ResolvedPackages keyed by model@version.
// The domain-tier counterpart to StoragePackageSource, with no publish / storage
// dependency (callers bridge CompiledPackages in via PackageManifestBridge).
export class MemoryPackageSource implements PackageSource
{
    private readonly byIdentity = new Map<string, ResolvedPackage>();

    constructor(packages?: Iterable<ResolvedPackage>)
    {
        for (const pkg of packages ?? []) this.Add(pkg);
    }

    public Add(pkg: ResolvedPackage): void
    {
        this.byIdentity.set(Domain.identity(pkg.ref), pkg);
    }

    public resolve(ref: PackageRef): Promise<ResolvedPackage>
    {
        if (ref.version === undefined) return Promise.reject(new Error(`memory source needs a pinned version for "${ref.model}"`));
        const found = this.byIdentity.get(Domain.identity({ model: ref.model, version: ref.version }));
        if (found === undefined) return Promise.reject(new Error(`unknown ${ref.model}@${ref.version}`));
        return Promise.resolve(found);
    }

    public versions(model: string): Promise<readonly string[]>
    {
        const out: string[] = [];
        for (const pkg of this.byIdentity.values()) if (pkg.ref.model === model) out.push(pkg.ref.version);
        return Promise.resolve(out);
    }
}
