import type { PackageRef } from "../../publish/publish.js";
import type { IPackageSource, CompiledPackage } from "./package-source.js";
import type { IWritablePackageSource } from "./solution-cache-source.js";

// Read-through cache (spec §8.3): checks its backing cache, and on a miss delegates
// to `upstream` and writes the result back. The only writer in the source chain —
// CompositePackageSource stays pure fallback.
export class CachingPackageSource implements IPackageSource
{
    constructor(
        private readonly cache: IWritablePackageSource,
        private readonly upstream: IPackageSource,
    )
    {
    }

    public async TryGet(reference: PackageRef): Promise<CompiledPackage | undefined>
    {
        const cached = await this.cache.TryGet(reference);
        if (cached !== undefined) return cached;

        const fetched = await this.upstream.TryGet(reference);
        if (fetched === undefined) return undefined;

        await this.cache.Put(reference, fetched);
        return fetched;
    }
}
