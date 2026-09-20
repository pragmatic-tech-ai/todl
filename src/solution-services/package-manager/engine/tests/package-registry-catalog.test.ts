import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PackageRegistryCatalog } from '../package-registry-catalog.js'
import { type IPackageRegistryFactory, type IPackageRegistryConnectionFactory } from '../registry-factory.js'
import { type IPackageRegistry } from '../package-registry.js'
import { type IPackageRegistryConnection, type ConnectionSpec } from '../registry-connection.js'

// A minimal registry factory establishing `type`. The clients it builds are never
// exercised here — the catalog only indexes factories.
function registryFactory(type: string): IPackageRegistryFactory
{
    return {
        RegistryType: type,
        Title: `${type} registry`,
        Create: (_connection: IPackageRegistryConnection): IPackageRegistry =>
        {
            throw new Error('not exercised')
        },
    }
}

function connectionFactory(type: string): IPackageRegistryConnectionFactory
{
    return {
        RegistryType: type,
        Title: `${type} connections`,
        SettingsSchema: [],
        Presets: [],
        Create: (spec: ConnectionSpec, _secret?: string): IPackageRegistryConnection => ({
            Id: spec.Id,
            DisplayName: spec.DisplayName,
            RegistryType: spec.RegistryType,
        }),
    }
}

test('indexes registry and connection factories by their declared type', () =>
{
    const catalog = new PackageRegistryCatalog([registryFactory('npm')], [connectionFactory('npm')])

    assert.equal(catalog.RegistryFactory('npm')?.RegistryType, 'npm')
    assert.equal(catalog.ConnectionFactory('npm')?.RegistryType, 'npm')
    assert.deepEqual(catalog.RegistryTypes(), ['npm'])
})

test('a registry type with no connection factory still resolves its registry factory', () =>
{
    const catalog = new PackageRegistryCatalog([registryFactory('npm')], [])

    assert.ok(catalog.RegistryFactory('npm'))
    assert.equal(catalog.ConnectionFactory('npm'), undefined)
})

test('an unknown registry type resolves to undefined on both sides', () =>
{
    const catalog = new PackageRegistryCatalog([registryFactory('npm')], [connectionFactory('npm')])

    assert.equal(catalog.RegistryFactory('oci'), undefined)
    assert.equal(catalog.ConnectionFactory('oci'), undefined)
})

test('a connection factory whose type no registry factory established is rejected', () =>
{
    assert.throws(
        () => new PackageRegistryCatalog([registryFactory('npm')], [connectionFactory('oci')]),
        /oci/,
    )
})

test('the first factory to claim a registry type wins; a duplicate is ignored', () =>
{
    const first = registryFactory('npm')
    const second = registryFactory('npm')
    const catalog = new PackageRegistryCatalog([first, second], [])

    assert.equal(catalog.RegistryFactory('npm'), first)
})
