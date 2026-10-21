import { NpmRegistry, type NpmRegistryConfig, FetchTransport, type HttpTransport } from '../../registry/index.js'
import { type NpmRegistryConnection } from './npm-connection.js'
import {
    type IPackageRegistry,
    type PublishablePackage,
    type ConnectionStatus,
    type RegistryInspection,
    type PackageRef,
    type VersionList,
    type PackageManifestJson,
} from '../../engine/package-registry.js'

// The HTTP npm backend as an IPackageRegistry: it reshapes the existing NpmRegistry
// wire client (kept intact, still unit-tested against the in-memory transport) onto
// the abstraction's PascalCase surface, built from an NpmRegistryConnection. Test()
// probes the registry base and maps an auth/5xx status to a failed ConnectionStatus.
export class NpmHttpRegistry implements IPackageRegistry
{
    private readonly registry: NpmRegistry
    private readonly transport: HttpTransport
    private readonly registryUrl: string
    private readonly token: string
    private readonly isGithub: boolean

    constructor(connection: NpmRegistryConnection, transport: HttpTransport = new FetchTransport())
    {
        this.isGithub = connection.GithubApi !== undefined
        this.transport = transport
        this.registryUrl = connection.Registry.replace(/\/+$/, '')
        this.token = connection.Token
        const config: NpmRegistryConfig = {
            registry: connection.Registry,
            scope: connection.Scope,
            token: connection.Token,
            transport,
        }
        if (connection.GithubApi !== undefined) config.githubApi = connection.GithubApi
        if (connection.Org !== undefined) config.org = connection.Org
        this.registry = new NpmRegistry(config)
    }

    public ListPackages(): Promise<string[]>
    {
        return this.registry.listPackages()
    }

    public ListVersions(name: string): Promise<VersionList>
    {
        return this.registry.listVersions(name)
    }

    public GetManifest(ref: PackageRef): Promise<PackageManifestJson>
    {
        return this.registry.getManifest(ref)
    }

    public GetContent(ref: PackageRef): Promise<Uint8Array>
    {
        return this.registry.getContent(ref)
    }

    public Publish(pkg: PublishablePackage): Promise<void>
    {
        return this.registry.publish(pkg.Manifest, pkg.Tarball)
    }

    public DeleteVersion(name: string, version: string): Promise<void>
    {
        return this.registry.deleteVersion(name, version)
    }

    public async Test(): Promise<ConnectionStatus>
    {
        try
        {
            const res = await this.transport.request({
                method: 'GET',
                url: this.registryUrl,
                headers: { authorization: `Bearer ${this.token}` },
            })
            if (res.status === 401 || res.status === 403)
            {
                return { Ok: false, Message: `authentication failed: HTTP ${res.status}` }
            }
            if (res.status >= 500)
            {
                return { Ok: false, Message: `registry error: HTTP ${res.status}` }
            }
            return { Ok: true, Message: `HTTP ${res.status}` }
        }
        catch (error)
        {
            return { Ok: false, Message: error instanceof Error ? error.message : String(error) }
        }
    }

    // Test() plus the token's identity, scopes and visible packages. GitHub
    // connections report all three; a generic npm registry reports only the whoami
    // identity. Each facet degrades to empty on failure rather than throwing.
    public async Inspect(): Promise<RegistryInspection>
    {
        const status = await this.Test()
        const result: RegistryInspection =
        {
            Ok: status.Ok,
            Message: status.Message,
            Identity: '',
            Scopes: [],
            ScopesSupported: this.isGithub,
            Packages: [],
            PackagesSupported: this.isGithub,
        }
        if (!status.Ok) return result
        if (this.isGithub)
        {
            try
            {
                const who = await this.registry.githubUser()
                result.Identity = who.identity
                result.Scopes = who.scopes
            }
            catch
            {
                // degrade: identity/scopes stay empty
            }
            try
            {
                result.Packages = await this.registry.listPackages()
            }
            catch
            {
                // degrade: packages stay empty
            }
        }
        else
        {
            try
            {
                result.Identity = await this.registry.npmWhoami()
            }
            catch
            {
                // degrade: identity stays empty
            }
        }
        return result
    }
}
