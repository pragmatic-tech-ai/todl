import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { PackageManagerService } from '../package-manager-service.js'
import { PackageRegistryCatalog, PackageRegistryCatalogKey } from '../package-registry-catalog.js'
import { ConnectionStoreKey } from '../connection-store.js'
import { SecretStoreKey } from '../secret-store.js'
import { ConnectionFieldKind, type ConnectionSpec } from '../registry-connection.js'
import { FakeConnectionStore, FakeSecretStore, FakeBackend, FakeRegistry } from './fakes.js'

// Build a provider wired with a real catalog over the fake backend plus fake
// stores, and the service under test. Returns the pieces a test asserts on.
function harness(): {
    service: PackageManagerService
    backend: FakeBackend
    store: FakeConnectionStore
    secrets: FakeSecretStore
}
{
    const backend = new FakeBackend()
    const store = new FakeConnectionStore()
    const secrets = new FakeSecretStore()
    const catalog = new PackageRegistryCatalog([backend.RegistryFactory()], [backend.ConnectionFactory()])

    const provider = new ServiceProvider()
    provider.registerInstance(PackageRegistryCatalogKey, catalog)
    provider.registerInstance(ConnectionStoreKey, store)
    provider.registerInstance(SecretStoreKey, secrets)

    return { service: new PackageManagerService(provider), backend, store, secrets }
}

function spec(id: string): ConnectionSpec
{
    return { Id: id, DisplayName: id, RegistryType: FakeBackend.RegistryType, Settings: {} }
}

test('adds a connection, persisting its spec and secret', async () =>
{
    const { service, store, secrets } = harness()

    await service.AddConnection(spec('gh'), 'token-1')

    const connections = await service.Connections()
    assert.deepEqual(connections.map((c) => c.Id), ['gh'])
    assert.equal((await store.Get('gh'))?.RegistryType, FakeBackend.RegistryType)
    assert.equal(await secrets.Get('gh'), 'token-1')
})

test('rejects a connection whose registry type has no factory', async () =>
{
    const { service } = harness()

    await assert.rejects(
        () => service.AddConnection({ ...spec('x'), RegistryType: 'oci' }),
        /oci/,
    )
})

test('removes a connection, dropping its spec and secret', async () =>
{
    const { service, store, secrets } = harness()
    await service.AddConnection(spec('gh'), 'token-1')

    await service.RemoveConnection('gh')

    assert.equal(await store.Get('gh'), undefined)
    assert.equal(await secrets.Get('gh'), undefined)
    assert.deepEqual(await service.Connections(), [])
})

test('builds a live registry from a connection, passing the stored secret', async () =>
{
    const { service, backend } = harness()
    await service.AddConnection(spec('gh'), 'token-1')

    const registry = await service.RegistryFor('gh')

    assert.equal(registry, backend.RegistryFor('gh'))
    assert.equal(backend.SecretsSeen.get('gh'), 'token-1')
})

test('caches the live registry per connection', async () =>
{
    const { service } = harness()
    await service.AddConnection(spec('gh'), 'token-1')

    assert.equal(await service.RegistryFor('gh'), await service.RegistryFor('gh'))
})

test('RegistryFor throws for an unknown connection', async () =>
{
    const { service } = harness()

    await assert.rejects(() => service.RegistryFor('missing'), /missing/)
})

test('lists packages across every connection, labelled by connection', async () =>
{
    const { service, backend } = harness()
    await service.AddConnection(spec('a'), 't')
    await service.AddConnection(spec('b'), 't')
    backend.Register('a', new FakeRegistry(new Map([['@x/one', { versions: ['1.0.0'], distTags: {} }]])))
    backend.Register('b', new FakeRegistry(new Map([['@x/two', { versions: ['2.0.0'], distTags: {} }]])))

    const listings = await service.ListPackages()

    assert.deepEqual(
        listings.map((l) => `${l.ConnectionId}:${l.Name}`).sort(),
        ['a:@x/one', 'b:@x/two'],
    )
})

test('unions a package versions across connections', async () =>
{
    const { service, backend } = harness()
    await service.AddConnection(spec('a'), 't')
    await service.AddConnection(spec('b'), 't')
    backend.Register('a', new FakeRegistry(new Map([['@x/one', { versions: ['1.0.0', '1.1.0'], distTags: {} }]])))
    backend.Register('b', new FakeRegistry(new Map([['@x/one', { versions: ['1.1.0', '2.0.0'], distTags: {} }]])))

    const versions = await service.ListVersions('@x/one')

    assert.deepEqual(versions.versions, ['1.0.0', '1.1.0', '2.0.0'])
})

test('fetches content from the first connection that has the ref', async () =>
{
    const { service, backend } = harness()
    await service.AddConnection(spec('a'), 't')
    await service.AddConnection(spec('b'), 't')
    backend.Register('a', new FakeRegistry()) // has nothing → GetContent throws
    backend.Register('b', new FakeRegistry(new Map(), new Map([['@x/one', new Uint8Array([1, 2, 3])]])))

    const bytes = await service.GetContent({ name: '@x/one' })

    assert.deepEqual([...bytes], [1, 2, 3])
})

test('publishes to the named connection only', async () =>
{
    const { service, backend } = harness()
    await service.AddConnection(spec('a'), 't')
    await service.AddConnection(spec('b'), 't')
    const target = new FakeRegistry()
    const other = new FakeRegistry()
    backend.Register('a', target)
    backend.Register('b', other)

    await service.Publish('a', { Manifest: { name: '@x/one', version: '1.0.0' }, Tarball: new Uint8Array() })

    assert.equal(target.Published.length, 1)
    assert.equal(other.Published.length, 0)
})

test('tests a connection through its live registry', async () =>
{
    const { service, backend } = harness()
    await service.AddConnection(spec('gh'), 't')
    const registry = backend.RegistryFor('gh')
    registry.TestResult = { Ok: false, Message: 'unauthorized' }

    const status = await service.TestConnection('gh')

    assert.equal(status.Ok, false)
    assert.equal(status.Message, 'unauthorized')
})
