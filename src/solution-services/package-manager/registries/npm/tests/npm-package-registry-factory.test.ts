import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ServiceProvider, StorageProviderKey, FakeStorage, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { NpmPackageRegistryFactory } from '../npm-package-registry-factory.js'
import { NpmConnectionFactory } from '../npm-connection-factory.js'
import { DefaultPackageRegistryCatalog } from '../default-package-registry-catalog.js'
import { NpmRegistryConnection, LocalDirectoryConnection, NpmRegistryType } from '../npm-connection.js'
import { NpmHttpRegistry } from '../npm-http-registry.js'
import { LocalNpmRegistry } from '../local-npm-registry.js'
import { HttpTransportKey, type HttpTransport } from '../../../registry/index.js'

// A storage provider that hands every location the same in-memory FakeStorage.
class FakeStorageProvider
{
    public readonly storage = new FakeStorage()
    public CreateStorage(_location: string): IStorage
    {
        return this.storage
    }
}

const idleTransport: HttpTransport = {
    request: () => Promise.resolve({ status: 200, headers: {}, body: new Uint8Array() }),
}

function provider(): ServiceProvider
{
    const p = new ServiceProvider()
    p.registerInstance(HttpTransportKey, idleTransport)
    p.registerInstance(StorageProviderKey, new FakeStorageProvider())
    return p
}

test('builds an NpmHttpRegistry for an HTTP connection', () =>
{
    const factory = new NpmPackageRegistryFactory(provider())
    const connection = new NpmRegistryConnection({
        Id: 'gh', DisplayName: 'GitHub', Registry: 'https://npm.pkg.github.com', Scope: '@acme', Token: 't',
    })

    assert.ok(factory.Create(connection) instanceof NpmHttpRegistry)
})

test('builds a LocalNpmRegistry for a local-directory connection', () =>
{
    const factory = new NpmPackageRegistryFactory(provider())
    const connection = new LocalDirectoryConnection('local', 'Local', '/pkgs')

    assert.ok(factory.Create(connection) instanceof LocalNpmRegistry)
})

test('the default catalog establishes the npm type from the two npm factories', () =>
{
    const p = provider()
    p.registerInstance(NpmPackageRegistryFactory.Key, new NpmPackageRegistryFactory(p))
    p.registerInstance(NpmConnectionFactory.Key, new NpmConnectionFactory(p))

    const catalog = new DefaultPackageRegistryCatalog(p)

    assert.deepEqual(catalog.RegistryTypes(), [NpmRegistryType])
    assert.equal(catalog.RegistryFactory(NpmRegistryType)?.RegistryType, NpmRegistryType)
    assert.equal(catalog.ConnectionFactory(NpmRegistryType)?.RegistryType, NpmRegistryType)
})
