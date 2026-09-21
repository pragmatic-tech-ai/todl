import type { PackageRef } from "../../publish/publish.js";
import type { IPackageSource, SourcedPackage } from "./package-source.js";

// Tries its sources in order and returns the first hit; never mutates (spec §8.3).
// Pure fallback — read-through population lives in CachingPackageSource.
export class CompositePackageSource implements IPackageSource
{
    constructor(private readonly sources: readonly IPackageSource[])
    {
    }

    public async TryGet(reference: PackageRef): Promise<SourcedPackage | undefined>
    {
        for (const source of this.sources)
        {
            const found = await source.TryGet(reference);
            if (found !== undefined) return found;
        }
        return undefined;
    }
}
