import { ServiceKey, StorageProviderKey, type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { FetchTransport, HttpTransportKey } from '../../registry/index.js'
import { type IPackageRegistry } from '../../engine/package-registry.js'
import { type IPackageRegistryFactory } from '../../engine/registry-factory.js'
import { type IPackageRegistryConnection } from '../../engine/registry-connection.js'
import {
    NpmConnectionKind,
    NpmRegistryType,
    type NpmConnection,
    type NpmRegistryConnection,
    type LocalDirectoryConnection,
} from './npm-connection.js'
import { NpmHttpRegistry } from './npm-http-registry.js'
import { LocalNpmRegistry } from './local-npm-registry.js'

// Establishes the npm registry type and builds a live client per connection,
// dispatching on the connection's Kind: an HTTP connection → NpmHttpRegistry (over
// an injected HttpTransport, falling back to FetchTransport); a local-directory
// connection → LocalNpmRegistry over an IStorage rooted at the directory (from the
// host's IStorageProvider).
export class NpmPackageRegistryFactory implements IPackageRegistryFactory
{
    public static readonly Key = new ServiceKey<NpmPackageRegistryFactory>('NpmPackageRegistryFactory')

    public readonly RegistryType = NpmRegistryType
    public readonly Title = 'npm registry'

    private static readonly WrongTypeMessage = 'not an npm connection: "{type}"'

    constructor(private readonly provider: IServiceProvider)
    {
    }

    public Create(connection: IPackageRegistryConnection): IPackageRegistry
    {
        if (connection.RegistryType !== NpmRegistryType)
        {
            throw new Error(
                NpmPackageRegistryFactory.WrongTypeMessage.replace('{type}', connection.RegistryType),
            )
        }
        const npm = connection as NpmConnection
        if (npm.Kind === NpmConnectionKind.LocalDirectory)
        {
            const directory = (npm as LocalDirectoryConnection).Directory
            const storage = this.provider.getRequired(StorageProviderKey).CreateStorage(directory)
            return new LocalNpmRegistry(storage)
        }
        const transport = this.provider.get(HttpTransportKey) ?? new FetchTransport()
        return new NpmHttpRegistry(npm as NpmRegistryConnection, transport)
    }
}
