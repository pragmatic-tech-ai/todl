import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { TarReader } from '../../registry/index.js'
import {
    type IPackageRegistry,
    type PublishablePackage,
    type ConnectionStatus,
    type PackageRef,
    type VersionList,
    type PackageManifestJson,
} from '../../engine/package-registry.js'

// An IPackageRegistry over a local directory (via IStorage). Publish writes the
// gzipped tarball, unpacks its `package/**` entries to disk, and records the
// version; the reads serve those back. The on-disk layout is
// `<name>/<version>/…` — the tarball at `package.tgz`, the manifest at
// `package.json`, and the unpacked payload (model.json, sources, resources)
// alongside, so StoragePackageSource reads the exact same tree this writes.
export class LocalNpmRegistry implements IPackageRegistry
{
    // Fixed file names / prefixes hoisted out of the method bodies.
    private static readonly TarballFile = 'package.tgz'
    private static readonly ManifestFile = 'package.json'
    private static readonly PackagePrefix = 'package/'
    private static readonly LatestTag = 'latest'
    private static readonly OkMessage = 'local directory registry ready'

    private readonly decoder = new TextDecoder()

    constructor(private readonly storage: IStorage)
    {
    }

    // Every published package name: each top-level entry is either a scope folder
    // (`@scope`, whose children are the scoped names) or a bare package folder.
    public async ListPackages(): Promise<string[]>
    {
        const names: string[] = []
        for (const entry of await this.storage.List(''))
        {
            if (!entry.IsDirectory) continue
            if (entry.Name.startsWith('@'))
            {
                for (const child of await this.storage.List(entry.Name))
                {
                    if (child.IsDirectory) names.push(`${entry.Name}/${child.Name}`)
                }
            }
            else
            {
                names.push(entry.Name)
            }
        }
        return names
    }

    // A package's versions (its version sub-folders) with `latest` pinned to the
    // highest semver.
    public async ListVersions(name: string): Promise<VersionList>
    {
        const versions = await this.versionsOf(name)
        const distTags: Record<string, string> = {}
        const latest = LocalNpmRegistry.latestOf(versions)
        if (latest !== undefined) distTags[LocalNpmRegistry.LatestTag] = latest
        return { versions, distTags }
    }

    public async GetManifest(ref: PackageRef): Promise<PackageManifestJson>
    {
        const version = await this.resolveVersion(ref)
        const path = `${ref.name}/${version}/${LocalNpmRegistry.ManifestFile}`
        return JSON.parse(await this.storage.ReadText(path)) as PackageManifestJson
    }

    public async GetContent(ref: PackageRef): Promise<Uint8Array>
    {
        const version = await this.resolveVersion(ref)
        return this.storage.ReadBytes(`${ref.name}/${version}/${LocalNpmRegistry.TarballFile}`)
    }

    // Write the tarball, its manifest, and the unpacked `package/**` payload under
    // `<name>/<version>/`.
    public async Publish(pkg: PublishablePackage): Promise<void>
    {
        const { name, version } = pkg.Manifest
        const dir = `${name}/${version}`
        await this.storage.WriteBytes(`${dir}/${LocalNpmRegistry.TarballFile}`, pkg.Tarball)
        await this.storage.WriteText(
            `${dir}/${LocalNpmRegistry.ManifestFile}`,
            JSON.stringify(pkg.Manifest, null, 2),
        )
        for (const file of TarReader.read(pkg.Tarball))
        {
            if (!file.path.startsWith(LocalNpmRegistry.PackagePrefix)) continue
            const rel = file.path.slice(LocalNpmRegistry.PackagePrefix.length)
            if (rel === '') continue
            await this.storage.WriteBytes(`${dir}/${rel}`, file.bytes)
        }
    }

    public async DeleteVersion(name: string, version: string): Promise<void>
    {
        await this.storage.Delete(`${name}/${version}`)
    }

    public async Test(): Promise<ConnectionStatus>
    {
        return { Ok: true, Message: LocalNpmRegistry.OkMessage }
    }

    private async versionsOf(name: string): Promise<string[]>
    {
        const entries = await this.storage.List(name)
        return entries.filter((e) => e.IsDirectory).map((e) => e.Name).sort()
    }

    private async resolveVersion(ref: PackageRef): Promise<string>
    {
        if (ref.version !== undefined) return ref.version
        const latest = LocalNpmRegistry.latestOf(await this.versionsOf(ref.name))
        if (latest === undefined) throw new Error(`no versions of "${ref.name}" in storage`)
        return latest
    }

    // The highest version by dotted-numeric comparison (1.10.0 > 1.9.0); a
    // non-numeric segment falls back to string order.
    private static latestOf(versions: readonly string[]): string | undefined
    {
        if (versions.length === 0) return undefined
        return [...versions].sort((a, b) => LocalNpmRegistry.compareVersions(b, a))[0]
    }

    private static compareVersions(a: string, b: string): number
    {
        const pa = a.split('.')
        const pb = b.split('.')
        for (let i = 0; i < Math.max(pa.length, pb.length); i++)
        {
            const na = Number(pa[i] ?? 0)
            const nb = Number(pb[i] ?? 0)
            if (Number.isNaN(na) || Number.isNaN(nb))
            {
                const s = (pa[i] ?? '').localeCompare(pb[i] ?? '')
                if (s !== 0) return s
                continue
            }
            if (na !== nb) return na - nb
        }
        return 0
    }
}
