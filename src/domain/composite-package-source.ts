import { type PackageSource, type PackageRef, type ResolvedPackage } from "./domain.js";
import type { ResourceSource } from "./resource-source.js";
import type { ResourceContent } from "./contributor.js";

// A PackageSource over an ordered collection of child sources: resolve tries each in
// order (first success wins); versions unions across children. Also a ResourceSource:
// resource() tries each member that has the capability, first non-undefined wins. This
// is how a DomainHost composes "a collection of package sources including in-memory ones".
export class CompositePackageSource implements PackageSource, ResourceSource
{
    constructor(private readonly sources: readonly (PackageSource | ResourceSource)[]) {}

    public async resolve(ref: PackageRef): Promise<ResolvedPackage>
    {
        for (const source of this.sources)
        {
            if (!CompositePackageSource.isPackageSource(source)) continue;
            try
            {
                return await source.resolve(ref);
            }
            catch
            {
                // try the next source
            }
        }
        const at = ref.version === undefined ? ref.model : `${ref.model}@${ref.version}`;
        throw new Error(`no source could resolve "${at}"`);
    }

    public async versions(model: string): Promise<readonly string[]>
    {
        const seen = new Set<string>();
        for (const source of this.sources)
        {
            if (!CompositePackageSource.isPackageSource(source) || source.versions === undefined) continue;
            for (const version of await source.versions(model)) seen.add(version);
        }
        return [...seen];
    }

    public async resource(uri: string): Promise<ResourceContent | undefined>
    {
        for (const source of this.sources)
        {
            if (!CompositePackageSource.isResourceSource(source)) continue;
            const found = await source.resource(uri);
            if (found !== undefined) return found;
        }
        return undefined;
    }

    private static isPackageSource(s: PackageSource | ResourceSource): s is PackageSource
    {
        return typeof (s as Partial<PackageSource>).resolve === "function";
    }

    private static isResourceSource(s: PackageSource | ResourceSource): s is ResourceSource
    {
        return typeof (s as Partial<ResourceSource>).resource === "function";
    }
}
