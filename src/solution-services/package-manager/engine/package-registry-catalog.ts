import { ServiceKey } from '@pragmatic-tech-ai/todl-runtime'
import {
    type IPackageRegistryFactory,
    type IPackageRegistryConnectionFactory,
} from './registry-factory.js'

// Indexes the installed factories by registry type and answers the two consumers:
// RegistryFactory(type) (the PackageManagerService, building a live client) and
// ConnectionFactory(type) (a host's connection editor). It ENFORCES the ordering
// rule — a connection factory may only declare a type an IPackageRegistryFactory
// has established — throwing at construction otherwise. Mirrors
// ProjectFactoryRegistry: list-based ctor, first-to-claim-a-type wins.
export interface IPackageRegistryCatalog
{
    RegistryFactory(registryType: string): IPackageRegistryFactory | undefined
    ConnectionFactory(registryType: string): IPackageRegistryConnectionFactory | undefined
    RegistryTypes(): readonly string[]
}

export class PackageRegistryCatalog implements IPackageRegistryCatalog
{
    // Thrown when a connection factory declares a registry type no registry factory
    // has established — the ordering rule ("the type is defined during registry
    // registration"). `{type}` is substituted at the throw site.
    private static readonly UnknownTypeMessage =
        'connection factory declares unknown registry type "{type}"'

    private readonly registryFactories = new Map<string, IPackageRegistryFactory>()
    private readonly connectionFactories = new Map<string, IPackageRegistryConnectionFactory>()

    constructor(
        registryFactories: readonly IPackageRegistryFactory[],
        connectionFactories: readonly IPackageRegistryConnectionFactory[],
    )
    {
        for (const factory of registryFactories)
        {
            if (this.registryFactories.has(factory.RegistryType)) continue
            this.registryFactories.set(factory.RegistryType, factory)
        }
        for (const factory of connectionFactories)
        {
            if (!this.registryFactories.has(factory.RegistryType))
            {
                throw new Error(
                    PackageRegistryCatalog.UnknownTypeMessage.replace('{type}', factory.RegistryType),
                )
            }
            if (this.connectionFactories.has(factory.RegistryType)) continue
            this.connectionFactories.set(factory.RegistryType, factory)
        }
    }

    public RegistryFactory(registryType: string): IPackageRegistryFactory | undefined
    {
        return this.registryFactories.get(registryType)
    }

    public ConnectionFactory(registryType: string): IPackageRegistryConnectionFactory | undefined
    {
        return this.connectionFactories.get(registryType)
    }

    public RegistryTypes(): readonly string[]
    {
        return [...this.registryFactories.keys()]
    }
}

// The container key the catalog registers under (standalone const, so a module's
// `.services:` markup can name it in the `Impl -> Token` form).
export const PackageRegistryCatalogKey =
    new ServiceKey<IPackageRegistryCatalog>('PackageRegistryCatalog')
