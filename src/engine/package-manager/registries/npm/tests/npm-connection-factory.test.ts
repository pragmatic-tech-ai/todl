import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { NpmConnectionFactory } from '../npm-connection-factory.js'
import { NpmRegistryConnection, LocalDirectoryConnection, NpmRegistryType } from '../npm-connection.js'
import { ConnectionFieldKind, type ConnectionSpec } from '../../../engine/registry-connection.js'

function factory(): NpmConnectionFactory
{
    return new NpmConnectionFactory(new ServiceProvider())
}

function httpSpec(settings: Record<string, string>): ConnectionSpec
{
    return { Id: 'gh', DisplayName: 'GitHub', RegistryType: NpmRegistryType, Settings: settings }
}

test('serves the npm registry type', () =>
{
    assert.equal(factory().RegistryType, NpmRegistryType)
})

test('exposes a token field the host routes to the secret store', () =>
{
    const token = factory().SettingsSchema.find((f) => f.Kind === ConnectionFieldKind.Secret)
    assert.ok(token, 'schema has a Secret field for the token')
})

test('offers a preset per backend, including a local directory', () =>
{
    const presets = factory().Presets
    assert.ok(presets.length >= 2)
    assert.ok(presets.some((p) => 'directory' in p.Settings), 'a Local Directory preset exists')
})

test('builds an HTTP connection from a registry spec, taking the token from the secret', () =>
{
    const connection = factory().Create(
        httpSpec({ registry: 'https://npm.pkg.github.com', scope: '@acme', org: 'acme' }),
        'secret-token',
    )

    assert.ok(connection instanceof NpmRegistryConnection)
    const npm = connection as NpmRegistryConnection
    assert.equal(npm.Registry, 'https://npm.pkg.github.com')
    assert.equal(npm.Scope, '@acme')
    assert.equal(npm.Org, 'acme')
    assert.equal(npm.Token, 'secret-token')
})

test('builds a local-directory connection when a directory is set', () =>
{
    const connection = factory().Create(
        { Id: 'local', DisplayName: 'Local', RegistryType: NpmRegistryType, Settings: { directory: '/pkgs' } },
    )

    assert.ok(connection instanceof LocalDirectoryConnection)
    assert.equal((connection as LocalDirectoryConnection).Directory, '/pkgs')
})
