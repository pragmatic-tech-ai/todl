import { type PackageSource, type PackageRef, type ResolvedPackage } from '../../../domain/domain.js'
import { PackageKind } from '../../../publish/publish.js'
import { type IPackageSource } from '../../todl-build-system/package-source.js'
import { PackageManifestBridge } from '../../package-manager/package-manifest-bridge.js'

// Adapts the TODL-side IPackageSource (TryGet -> SourcedPackage document) to the
// Domain's PackageSource (resolve -> manifest + deps + seed), so SolutionSession can
// compose through the one live-first SolutionBaseResolver. The conversion is the same
// document -> manifest bridge StoragePackageSource uses for published packages.
export class ResolverPackageSource implements PackageSource
{
    // Package ids are globally unique and a source does not route on kind, so the
    // adapter asks for a Library; the resolver matches live members by id alone.
    private static readonly RequestKind = PackageKind.Library
    // `source` supplies packages (live-first); `versionSource` is the published backend
    // whose versions() lets Domain.pin resolve a version-less ref to its latest
    // published version, exactly as when it was the Domain's own source.
    constructor(private readonly source: IPackageSource, private readonly versionSource: PackageSource) {}

    public async versions(model: string): Promise<readonly string[]>
    {
        return this.versionSource.versions === undefined ? [] : this.versionSource.versions(model)
    }

    public async resolve(ref: PackageRef): Promise<ResolvedPackage>
    {
        // Domain.pin always supplies a concrete version before resolve.
        const version = ref.version as string
        const sourced = await this.source.TryGet({ kind: ResolverPackageSource.RequestKind, id: ref.model, version })
        if (sourced === undefined) throw new Error(`package "${ref.model}@${version}" not found`)
        const dependencies = sourced.Dependencies.map((d) => ({ model: d.id, version: d.version }))
        return PackageManifestBridge.toResolvedDocument(sourced.Document, ref.model, version, dependencies)
    }
}
