import { type PackageSource, type PackageRef, type ResolvedPackage } from "./domain.js";

// A PackageSource over an ordered collection of child sources: resolve tries each in
// order (first success wins); versions unions across children. This is how a DomainHost
// composes "a collection of package sources including in-memory ones".
export class CompositePackageSource implements PackageSource
{
    constructor(private readonly sources: readonly PackageSource[]) {}

    public async resolve(ref: PackageRef): Promise<ResolvedPackage>
    {
        for (const source of this.sources)
        {
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
            if (source.versions === undefined) continue;
            for (const version of await source.versions(model)) seen.add(version);
        }
        return [...seen];
    }
}
