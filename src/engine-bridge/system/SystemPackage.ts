import type { IPackageDocumentSource, PackageRef, PackageSource, ResolvedPackage } from '../../domain/domain.js';
import type { PackageDocument } from '../../publish/publish.js';
import { PackageManifestBridge } from '../../solution-services/package-manager/package-manifest-bridge.js';
import { MessageFormat } from '../MessageFormat.js';
import { SystemPackageDocument } from '../../compiler-services/stdlib/system/system-package.generated.js';
import { SystemNames } from './SystemNames.js';

/**
 * Serves `todl.system@1.0.0` (ruling T10): the package compiled at build time from system.todl into
 * system-package.generated.ts, so runtime compiles nothing. It holds that one package and rejects every other ref. Each
 * call returns a fresh copy of the document, never the embedded constant.
 */
export class SystemPackage implements PackageSource, IPackageDocumentSource
{
    public static readonly Ref: Required<PackageRef> = Object.freeze({ model: SystemNames.Model, version: SystemNames.Version });

    private static readonly UnknownMessage = 'the system package source holds only {0}@{1}, not {2}@{3}';
    private static readonly AnyVersion = '*';

    /** The system package lowered for the Domain (manifest as ManifestJson); it has no dependencies. */
    public async resolve(ref: PackageRef): Promise<ResolvedPackage>
    {
        const own = SystemPackage.Ref;
        return PackageManifestBridge.toResolvedJsonDocument(this.Copy(ref), own.model, own.version, []);
    }

    public async versions(model: string): Promise<readonly string[]>
    {
        return model === SystemPackage.Ref.model ? [SystemPackage.Ref.version] : [];
    }

    public async Document(ref: Required<PackageRef>): Promise<PackageDocument>
    {
        return this.Copy(ref);
    }

    /** A copy of the embedded document when `ref` names the system package (any version when unpinned); throws otherwise. */
    private Copy(ref: PackageRef): PackageDocument
    {
        const own = SystemPackage.Ref;
        if (ref.model !== own.model || (ref.version !== undefined && ref.version !== own.version))
        {
            throw new Error(MessageFormat.Format(SystemPackage.UnknownMessage, own.model, own.version, ref.model, ref.version ?? SystemPackage.AnyVersion));
        }
        return structuredClone(SystemPackageDocument.Document);
    }
}
