import type { IPackageDocumentSource, PackageRef, PackageSource, ResolvedPackage } from '../../domain/domain.js';
import type { PackageDocument } from '../../publish/publish.js';
import { CompileFoundation } from '../../compiler-services/stdlib/compile-foundation.js';
import { SystemPackage } from './system-package.js';

/**
 * A package source that serves `todl.system` (the dependency the compile foundation provides) from the embedded
 * SystemPackage and every other model from `inner`, whatever `inner` holds.
 */
export class SystemFirstPackageSource implements PackageSource, IPackageDocumentSource
{
    private readonly system = new SystemPackage();

    public constructor(private readonly inner: PackageSource & IPackageDocumentSource)
    {
    }

    public resolve(ref: PackageRef): Promise<ResolvedPackage>
    {
        return CompileFoundation.ProvidesDependency(ref.model) ? this.system.resolve(ref) : this.inner.resolve(ref);
    }

    public async versions(model: string): Promise<readonly string[]>
    {
        return CompileFoundation.ProvidesDependency(model) ? this.system.versions(model) : ((await this.inner.versions?.(model)) ?? []);
    }

    public Document(ref: Required<PackageRef>): Promise<PackageDocument>
    {
        return CompileFoundation.ProvidesDependency(ref.model) ? this.system.Document(ref) : this.inner.Document(ref);
    }
}
