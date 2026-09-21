import type { PackageRef } from "../../publish/publish.js";
import type { IPackageSource } from "./package-source.js";

// What a restore pass resolved and what it could not.
export interface RestoreResult
{
    /** Refs (roots + transitive deps) resolved through the source — the cache is now warm. */
    Restored: readonly PackageRef[];
    /** Refs the source could not resolve (unpublished / not found). */
    Missing: readonly PackageRef[];
}

// Eager restore (spec §8.4): before any build — on solution open, or when a project gains
// external refs — walk the external roots and their transitive closure through a source,
// warming the solution cache ahead of time. Given a CachingPackageSource, each resolved ref
// is written into the cache as a side effect (read-through), so a later build resolves
// offline. Purely a warm-up: it reads through the same seam the resolver uses, and reports
// unresolved refs for the caller to surface — it does not fail.
export class SolutionRestore
{
    constructor(private readonly source: IPackageSource)
    {
    }

    public async Restore(roots: readonly PackageRef[]): Promise<RestoreResult>
    {
        const restored: PackageRef[] = [];
        const missing: PackageRef[] = [];
        const seen = new Set<string>();
        const queue: PackageRef[] = [...roots];

        while (queue.length > 0)
        {
            const reference = queue.shift()!;
            const key = SolutionRestore.KeyOf(reference);
            if (seen.has(key)) continue;
            seen.add(key);

            const pkg = await this.source.TryGet(reference);
            if (pkg === undefined)
            {
                missing.push(reference);
                continue;
            }
            restored.push(reference);
            for (const dep of pkg.Dependencies) queue.push(dep);
        }

        return { Restored: restored, Missing: missing };
    }

    private static KeyOf(reference: PackageRef): string
    {
        return `${reference.id}@${reference.version}`;
    }
}
