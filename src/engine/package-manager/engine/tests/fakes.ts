// Test doubles for the package-registry seams and backends. Kept out of the
// production classes (per the tests-honest rules): the service is exercised against
// these fakes, never a real network / disk registry.
import { type IConnectionStore } from '../connection-store.js'
import { type ISecretStore } from '../secret-store.js'
import {
    type IPackageRegistry,
    type PublishablePackage,
    type ConnectionStatus,
    type PackageRef,
    type VersionList,
    type PackageManifestJson,
} from '../package-registry.js'
import {
    type IPackageRegistryFactory,
    type IPackageRegistryConnectionFactory,
} from '../registry-factory.js'
import {
    type IPackageRegistryConnection,
    type ConnectionSpec,
} from '../registry-connection.js'

// An in-memory IConnectionStore.
export class FakeConnectionStore implements IConnectionStore
{
    private readonly specs = new Map<string, ConnectionSpec>()

    public async All(): Promise<readonly ConnectionSpec[]>
    {
        return [...this.specs.values()]
    }

    public async Get(id: string): Promise<ConnectionSpec | undefined>
    {
        return this.specs.get(id)
    }

    public async Save(spec: ConnectionSpec): Promise<void>
    {
        this.specs.set(spec.Id, spec)
    }

    public async Delete(id: string): Promise<void>
    {
        this.specs.delete(id)
    }
}

// An in-memory ISecretStore. `Seen` records the last secret handed to the
// connection factory, so a test can assert the secret was plumbed through.
export class FakeSecretStore implements ISecretStore
{
    private readonly secrets = new Map<string, string>()

    public async Get(key: string): Promise<string | undefined>
    {
        return this.secrets.get(key)
    }

    public async Set(key: string, secret: string): Promise<void>
    {
        this.secrets.set(key, secret)
    }

    public async Delete(key: string): Promise<void>
    {
        this.secrets.delete(key)
    }
}

// A registry backed by in-memory maps: `packages` drives ListPackages/ListVersions,
// `contents` (keyed `name` or `name@version`) drives GetContent, and Publish just
// records. `TestResult` is returned by Test.
export class FakeRegistry implements IPackageRegistry
{
    public readonly Published: PublishablePackage[] = []
    public TestResult: ConnectionStatus = { Ok: true, Message: 'ok' }

    constructor(
        private readonly packages: Map<string, VersionList> = new Map(),
        private readonly contents: Map<string, Uint8Array> = new Map(),
    )
    {
    }

    public async ListPackages(): Promise<string[]>
    {
        return [...this.packages.keys()]
    }

    public async ListVersions(name: string): Promise<VersionList>
    {
        return this.packages.get(name) ?? { versions: [], distTags: {} }
    }

    public async GetManifest(ref: PackageRef): Promise<PackageManifestJson>
    {
        return { name: ref.name, version: ref.version ?? 'latest' }
    }

    public async GetContent(ref: PackageRef): Promise<Uint8Array>
    {
        const key = ref.version !== undefined ? `${ref.name}@${ref.version}` : ref.name
        const bytes = this.contents.get(key) ?? this.contents.get(ref.name)
        if (bytes === undefined) throw new Error(`no content for ${key}`)
        return bytes
    }

    public async Publish(pkg: PublishablePackage): Promise<void>
    {
        this.Published.push(pkg)
    }

    public async DeleteVersion(_name: string, _version: string): Promise<void>
    {
    }

    public async Test(): Promise<ConnectionStatus>
    {
        return this.TestResult
    }
}

// A fake npm-like backend: maps each connection Id to a FakeRegistry, and exposes
// the two factories the catalog indexes. `SecretsSeen` records the (id → secret)
// pairs the connection factory received, so a test can assert secret plumbing.
export class FakeBackend
{
    public static readonly RegistryType = 'npm'
    public readonly SecretsSeen = new Map<string, string | undefined>()
    private readonly registries = new Map<string, FakeRegistry>()

    public Register(connectionId: string, registry: FakeRegistry): void
    {
        this.registries.set(connectionId, registry)
    }

    public RegistryFor(connectionId: string): FakeRegistry
    {
        let registry = this.registries.get(connectionId)
        if (registry === undefined)
        {
            registry = new FakeRegistry()
            this.registries.set(connectionId, registry)
        }
        return registry
    }

    public RegistryFactory(): IPackageRegistryFactory
    {
        return {
            RegistryType: FakeBackend.RegistryType,
            Title: 'fake npm',
            Create: (connection: IPackageRegistryConnection): IPackageRegistry =>
                this.RegistryFor(connection.Id),
        }
    }

    public ConnectionFactory(): IPackageRegistryConnectionFactory
    {
        return {
            RegistryType: FakeBackend.RegistryType,
            Title: 'fake npm connections',
            SettingsSchema: [],
            Presets: [],
            Create: (spec: ConnectionSpec, secret?: string): IPackageRegistryConnection =>
            {
                this.SecretsSeen.set(spec.Id, secret)
                return { Id: spec.Id, DisplayName: spec.DisplayName, RegistryType: spec.RegistryType }
            },
        }
    }
}
