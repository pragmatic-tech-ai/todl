// The registry ABSTRACTION — the type-neutral contract every registry backend
// implements. `NpmHttpRegistry` / `LocalNpmRegistry` (Phase 2) are the first
// implementations; the catalog keys implementations by registry TYPE and the
// PackageManagerService talks only to this interface, never to a concrete backend.
//
// The shared value shapes (PackageRef / VersionList / PackageManifestJson) are the
// canonical wire shapes; they currently live on the npm wire client and are
// re-exported here so the abstraction owns its contract while the migration
// (Phase 3) relocates their definitions.
import {
    type PackageRef,
    type VersionList,
    type PackageManifestJson,
} from '../registry/npm-registry.js'

export { type PackageRef, type VersionList, type PackageManifestJson }

// A package ready to publish: its parsed npm manifest plus the gzipped tarball
// bytes. Mirrors NpmRegistry.publish(manifest, tarball) — the two publish args as
// one value so IPackageRegistry.Publish stays single-argument.
export interface PublishablePackage
{
    Manifest: PackageManifestJson
    Tarball: Uint8Array
}

// The outcome of a connectivity / auth probe against a registry: a boolean plus a
// human-readable message (the failing status line, or an "ok" summary).
export interface ConnectionStatus
{
    Ok: boolean
    Message: string
}

// A live, per-connection client for one registry backend. Every registry TYPE
// (npm, …) provides an implementation, built from a connection by an
// IPackageRegistryFactory. This is the whole surface the engine needs: cross-package
// listing, per-package versions/manifest/content, publish, delete, and a probe.
export interface IPackageRegistry
{
    ListPackages(): Promise<string[]>
    ListVersions(name: string): Promise<VersionList>
    GetManifest(ref: PackageRef): Promise<PackageManifestJson>
    GetContent(ref: PackageRef): Promise<Uint8Array>
    Publish(pkg: PublishablePackage): Promise<void>
    DeleteVersion(name: string, version: string): Promise<void>
    Test(): Promise<ConnectionStatus>
}
