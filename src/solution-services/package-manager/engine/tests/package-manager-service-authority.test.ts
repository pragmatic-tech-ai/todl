import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { PackageManagerService } from '../package-manager-service.js'
import { PackageRegistryCatalog, PackageRegistryCatalogKey } from '../package-registry-catalog.js'
import { ConnectionStoreKey } from '../connection-store.js'
import { SecretStoreKey } from '../secret-store.js'
import { EnvironmentVariablesKey } from '../environment-variables.js'
import { TokenSource, type ConnectionSpec } from '../registry-connection.js'
import {
    FakeConnectionStore,
    FakeSecretStore,
    FakeEnvironmentVariables,
    FakeBackend,
} from './fakes.js'

// The service as the connection authority — over the fake backend + fake stores +
// a fake env. Returns the pieces a test asserts on.
function harness(env: Record<string, string> = {}): {
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
    provider.registerInstance(EnvironmentVariablesKey, new FakeEnvironmentVariables(env))

    return { service: new PackageManagerService(provider), backend, store, secrets }
}

function spec(id: string, extra: Partial<ConnectionSpec> = {}): ConnectionSpec
{
    return { Id: id, DisplayName: id, RegistryType: FakeBackend.RegistryType, Settings: {}, ...extra }
}

test('an env-sourced connection resolves its token from the environment', async () =>
{
    const { service, backend } = harness({ NPM_TOKEN: 'env-secret' })
    await service.AddConnection(spec('gh', { TokenSource: TokenSource.Env, TokenEnvVar: 'NPM_TOKEN' }))

    await service.RegistryFor('gh')

    assert.equal(backend.SecretsSeen.get('gh'), 'env-secret')
})

test('SetToken stores the secret and switches the source to Stored', async () =>
{
    const { service, backend, secrets } = harness()
    await service.AddConnection(spec('gh', { TokenSource: TokenSource.Env, TokenEnvVar: 'MISSING' }))

    await service.SetToken('gh', 'typed-secret')

    assert.equal(await secrets.Get('gh'), 'typed-secret')
    await service.RegistryFor('gh')
    assert.equal(backend.SecretsSeen.get('gh'), 'typed-secret')
})

test('UseEnvToken switches a connection to an env var', async () =>
{
    const { service, backend } = harness({ CI_TOKEN: 'ci-secret' })
    await service.AddConnection(spec('gh'), 'stored-secret')

    await service.UseEnvToken('gh', 'CI_TOKEN')

    await service.RegistryFor('gh')
    assert.equal(backend.SecretsSeen.get('gh'), 'ci-secret')
})

test('the first connection is the default; SetDefault changes it', async () =>
{
    const { service } = harness()
    await service.AddConnection(spec('a'), 't')
    await service.AddConnection(spec('b'), 't')

    assert.equal(await service.DefaultId(), 'a')
    await service.SetDefault('b')
    assert.equal(await service.DefaultId(), 'b')
})

test('RegistryFor with no id builds the default connection', async () =>
{
    const { service, backend } = harness()
    await service.AddConnection(spec('a'), 't')

    assert.equal(await service.RegistryFor(), backend.RegistryFor('a'))
})

test('UpdateConnection merges fields and rebuilds the client', async () =>
{
    const { service, store } = harness()
    await service.AddConnection(spec('gh', { Settings: { registry: 'https://one' } }), 't')

    await service.UpdateConnection('gh', { Settings: { registry: 'https://two' } })

    assert.equal((await store.Get('gh'))?.Settings['registry'], 'https://two')
})

test('ListViews reports token presence, source, and the default flag', async () =>
{
    const { service } = harness({ ENV_TOK: 'x' })
    await service.AddConnection(spec('stored'), 'secret')
    await service.AddConnection(spec('env', { TokenSource: TokenSource.Env, TokenEnvVar: 'ENV_TOK' }))
    await service.AddConnection(spec('none', { TokenSource: TokenSource.Env, TokenEnvVar: 'ABSENT' }))

    const views = await service.ListViews()
    const byId = new Map(views.map((v) => [v.Id, v]))

    assert.equal(byId.get('stored')?.HasToken, true)
    assert.equal(byId.get('stored')?.IsDefault, true)
    assert.equal(byId.get('env')?.HasToken, true)
    assert.equal(byId.get('env')?.TokenSource, TokenSource.Env)
    assert.equal(byId.get('none')?.HasToken, false)
})

test('ListEnvVars returns the environment names sorted', async () =>
{
    const { service } = harness({ B_VAR: '1', A_VAR: '2' })

    assert.deepEqual(await service.ListEnvVars(), ['A_VAR', 'B_VAR'])
})
