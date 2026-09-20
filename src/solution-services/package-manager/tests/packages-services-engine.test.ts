import { test } from 'node:test'
import assert from 'node:assert/strict'
import { create } from './packages-test-composition-root.mu.js'
import { ConnectionStoreKey } from '../engine/connection-store.js'
import { SecretStoreKey } from '../engine/secret-store.js'
import { PackageRegistryCatalogKey } from '../engine/package-registry-catalog.js'
import { NpmRegistryType } from '../registries/npm/npm-connection.js'
import { FakeConnectionStore, FakeSecretStore } from '../engine/tests/fakes.js'

// Compose the package engine exactly as a host would (from the .mu module), supply
// the two host store seams as fakes, and drive it end-to-end: the composed
// PackageManagerService resolves the DefaultPackageRegistryCatalog, which resolves
// the npm factories the module registered — so adding a connection and building its
// live registry works with no hand-wired provider.
function composed(): ReturnType<typeof create>
{
    const root = create()
    root.Provider.registerInstance(ConnectionStoreKey, new FakeConnectionStore())
    root.Provider.registerInstance(SecretStoreKey, new FakeSecretStore())
    return root
}

test('the composed engine establishes the npm registry type', () =>
{
    const catalog = composed().Provider.getRequired(PackageRegistryCatalogKey)

    assert.deepEqual(catalog.RegistryTypes(), [NpmRegistryType])
})

test('the composed PackageManagerService adds a connection and builds its registry', async () =>
{
    const manager = composed().Manager

    await manager.AddConnection(
        {
            Id: 'gh',
            DisplayName: 'GitHub',
            RegistryType: NpmRegistryType,
            Settings: { registry: 'https://npm.pkg.github.com' },
        },
        'token',
    )

    assert.deepEqual((await manager.Connections()).map((c) => c.Id), ['gh'])
    assert.ok(await manager.RegistryFor('gh'), 'builds a live registry through the composed catalog')
})
