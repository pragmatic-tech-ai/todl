import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { PackageRegistryCatalogKey, type IPackageRegistryCatalog } from './package-registry-catalog.js'
import { ConnectionStoreKey, type IConnectionStore } from './connection-store.js'
import { SecretStoreKey, type ISecretStore } from './secret-store.js'
import { type ConnectionSpec } from './registry-connection.js'
import {
    type IPackageRegistry,
    type PublishablePackage,
    type ConnectionStatus,
    type PackageRef,
    type VersionList,
} from './package-registry.js'

// A package name paired with the connection that publishes it — the aggregate
// ListPackages result (the same name may appear under several connections).
export interface PackageListing
{
    Name: string
    ConnectionId: string
}

// The engine orchestrator over registry connections (the package-side analogue of
// SolutionManagerService). It owns connection management (add/list/remove/test)
// and, for now, AGGREGATE package reads across every connection — solution↔packages
// scoping is designed later. Live IPackageRegistry clients are built via the
// catalog and cached per connection; secrets are resolved lazily from ISecretStore.
export class PackageManagerService extends ServiceBase
{
    public static readonly Key = new ServiceKey<PackageManagerService>('PackageManager')

    // Thrown when a connection names a registry type the catalog has no factory for.
    private static readonly UnknownTypeMessage =
        'no registry factory for connection type "{type}"'
    // Thrown when an operation names a connection the store does not hold.
    private static readonly UnknownConnectionMessage = 'no connection "{id}"'

    private readonly catalog: IPackageRegistryCatalog
    private readonly connectionStore: IConnectionStore
    private readonly secretStore: ISecretStore
    // Live clients, one per connection Id, built on first use and dropped when the
    // connection is added again (an update) or removed.
    private readonly registries = new Map<string, IPackageRegistry>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.catalog = provider.getRequired(PackageRegistryCatalogKey)
        this.connectionStore = provider.getRequired(ConnectionStoreKey)
        this.secretStore = provider.getRequired(SecretStoreKey)
    }

    // Persist a connection (and its secret, if any), after checking the catalog can
    // serve its registry type. Re-adding an existing Id updates it and drops the
    // cached client so the next RegistryFor rebuilds with the new settings/secret.
    public async AddConnection(spec: ConnectionSpec, secret?: string): Promise<void>
    {
        if (this.catalog.ConnectionFactory(spec.RegistryType) === undefined)
        {
            throw new Error(
                PackageManagerService.UnknownTypeMessage.replace('{type}', spec.RegistryType),
            )
        }
        await this.connectionStore.Save(spec)
        if (secret !== undefined) await this.secretStore.Set(spec.Id, secret)
        this.registries.delete(spec.Id)
    }

    public Connections(): Promise<readonly ConnectionSpec[]>
    {
        return this.connectionStore.All()
    }

    // Drop a connection everywhere it lives: the spec, its secret, and any cached
    // live client.
    public async RemoveConnection(id: string): Promise<void>
    {
        await this.connectionStore.Delete(id)
        await this.secretStore.Delete(id)
        this.registries.delete(id)
    }

    public async TestConnection(id: string): Promise<ConnectionStatus>
    {
        const registry = await this.RegistryFor(id)
        return registry.Test()
    }

    // Every package name across every connection, each labelled by its connection.
    // No dedupe — the same name under two connections is two listings.
    public async ListPackages(): Promise<PackageListing[]>
    {
        const listings: PackageListing[] = []
        for (const spec of await this.connectionStore.All())
        {
            const registry = await this.RegistryFor(spec.Id)
            for (const name of await registry.ListPackages())
            {
                listings.push({ Name: name, ConnectionId: spec.Id })
            }
        }
        return listings
    }

    // A package's versions unioned across every connection (deduped + sorted), with
    // dist-tags merged (a later connection's tag wins).
    public async ListVersions(name: string): Promise<VersionList>
    {
        const versions = new Set<string>()
        const distTags: Record<string, string> = {}
        for (const spec of await this.connectionStore.All())
        {
            const registry = await this.RegistryFor(spec.Id)
            const list = await registry.ListVersions(name)
            for (const version of list.versions) versions.add(version)
            Object.assign(distTags, list.distTags)
        }
        return { versions: [...versions].sort(), distTags }
    }

    // Content from the first connection that has the ref; throws only if none do.
    public async GetContent(ref: PackageRef): Promise<Uint8Array>
    {
        let lastError: unknown
        for (const spec of await this.connectionStore.All())
        {
            const registry = await this.RegistryFor(spec.Id)
            try
            {
                return await registry.GetContent(ref)
            }
            catch (error)
            {
                lastError = error
            }
        }
        throw lastError ?? new Error(`no connection has content for "${ref.name}"`)
    }

    public async Publish(connectionId: string, pkg: PublishablePackage): Promise<void>
    {
        const registry = await this.RegistryFor(connectionId)
        await registry.Publish(pkg)
    }

    // Build (and cache) the live client for a connection: resolve its spec, resolve
    // its secret, build the connection through the type's connection factory, then
    // the client through the type's registry factory.
    public async RegistryFor(connectionId: string): Promise<IPackageRegistry>
    {
        const cached = this.registries.get(connectionId)
        if (cached !== undefined) return cached

        const spec = await this.connectionStore.Get(connectionId)
        if (spec === undefined)
        {
            throw new Error(
                PackageManagerService.UnknownConnectionMessage.replace('{id}', connectionId),
            )
        }
        const connectionFactory = this.catalog.ConnectionFactory(spec.RegistryType)
        const registryFactory = this.catalog.RegistryFactory(spec.RegistryType)
        if (connectionFactory === undefined || registryFactory === undefined)
        {
            throw new Error(
                PackageManagerService.UnknownTypeMessage.replace('{type}', spec.RegistryType),
            )
        }
        const secret = await this.secretStore.Get(connectionId)
        const connection = connectionFactory.Create(spec, secret)
        const registry = registryFactory.Create(connection)
        this.registries.set(connectionId, registry)
        return registry
    }
}
