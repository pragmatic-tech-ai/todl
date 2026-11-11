import type { IPackageDocumentSource, PackageRef, PackageSource, ResolvedPackage } from '../../domain/domain.js';
import type { PackageDocument } from '../../publish/publish.js';
import { SystemNames } from './SystemNames.js';
import { SystemPackage } from './SystemPackage.js';

/** A package source that serves `todl.system` from SystemPackage and every other model from `inner`. */
export class SystemFirstPackageSource implements PackageSource, IPackageDocumentSource
{
    private readonly system = new SystemPackage();

    public constructor(private readonly inner: PackageSource & IPackageDocumentSource)
    {
    }

    public resolve(ref: PackageRef): Promise<ResolvedPackage>
    {
        return ref.model === SystemNames.Model ? this.system.resolve(ref) : this.inner.resolve(ref);
    }

    public async versions(model: string): Promise<readonly string[]>
    {
        return model === SystemNames.Model ? this.system.versions(model) : ((await this.inner.versions?.(model)) ?? []);
    }

    public Document(ref: Required<PackageRef>): Promise<PackageDocument>
    {
        return ref.model === SystemNames.Model ? this.system.Document(ref) : this.inner.Document(ref);
    }
}
