import type { PackageRef } from "../../../publish/publish.js";
import type { IPackageSource, SourcedPackage } from "../package-source.js";

// The accumulating source of a solution build (spec §9.4): starts empty and collects
// each project's output as it is built, so a later project resolves a sibling's
// just-built package here (at the front of the composite) before falling through to the
// cache/registry. In-memory and discarded when the solution build ends.
export class BuildOutputSource implements IPackageSource
{
    private readonly built = new Map<string, SourcedPackage>();

    public Add(id: string, version: string, pkg: SourcedPackage): void
    {
        this.built.set(BuildOutputSource.KeyOf(id, version), pkg);
    }

    public TryGet(reference: PackageRef): Promise<SourcedPackage | undefined>
    {
        return Promise.resolve(this.built.get(BuildOutputSource.KeyOf(reference.id, reference.version)));
    }

    private static KeyOf(id: string, version: string): string
    {
        return `${id}@${version}`;
    }
}
