import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { LocalNpmRegistry } from '../local-npm-registry.js'
import { createTgz } from '../../../registry/index.js'
import { type PublishablePackage } from '../../../engine/package-registry.js'

const enc = new TextEncoder()
const dec = new TextDecoder()

// Build a publishable npm package: a manifest + a real gzipped tarball whose
// `package/**` entries include a model.json (so the unpacked-to-disk layout can be
// asserted — the StoragePackageSource read side).
function publishable(name: string, version: string, model: unknown): PublishablePackage
{
    const manifest = { name, version }
    const tarball = createTgz([
        { path: 'package/package.json', bytes: enc.encode(JSON.stringify(manifest)) },
        { path: 'package/model.json', bytes: enc.encode(JSON.stringify(model)) },
    ])
    return { Manifest: manifest, Tarball: tarball }
}

test('publishes a package and reads its tarball back byte-for-byte', async () =>
{
    const storage = new FakeStorage()
    const registry = new LocalNpmRegistry(storage)
    const pkg = publishable('@x/one', '1.0.0', { id: 'one' })

    await registry.Publish(pkg)

    const content = await registry.GetContent({ name: '@x/one', version: '1.0.0' })
    assert.deepEqual([...content], [...pkg.Tarball])
})

test('lists a published package and its versions', async () =>
{
    const storage = new FakeStorage()
    const registry = new LocalNpmRegistry(storage)
    await registry.Publish(publishable('@x/one', '1.0.0', {}))
    await registry.Publish(publishable('@x/one', '1.1.0', {}))

    assert.deepEqual(await registry.ListPackages(), ['@x/one'])
    const versions = await registry.ListVersions('@x/one')
    assert.deepEqual(versions.versions, ['1.0.0', '1.1.0'])
    assert.equal(versions.distTags['latest'], '1.1.0')
})

test('an unversioned ref resolves to the latest version', async () =>
{
    const storage = new FakeStorage()
    const registry = new LocalNpmRegistry(storage)
    await registry.Publish(publishable('@x/one', '1.0.0', { id: 'old' }))
    await registry.Publish(publishable('@x/one', '1.1.0', { id: 'new' }))

    const manifest = await registry.GetManifest({ name: '@x/one' })
    assert.equal(manifest.version, '1.1.0')
})

test('unpacks the tarball to disk so a package-source can read model.json', async () =>
{
    const storage = new FakeStorage()
    const registry = new LocalNpmRegistry(storage)
    await registry.Publish(publishable('@x/one', '1.0.0', { id: 'one', kind: 'concept' }))

    const model = JSON.parse(await storage.ReadText('@x/one/1.0.0/model.json'))
    assert.equal(model.id, 'one')
})

test('deletes a published version', async () =>
{
    const storage = new FakeStorage()
    const registry = new LocalNpmRegistry(storage)
    await registry.Publish(publishable('@x/one', '1.0.0', {}))
    await registry.Publish(publishable('@x/one', '1.1.0', {}))

    await registry.DeleteVersion('@x/one', '1.0.0')

    assert.deepEqual((await registry.ListVersions('@x/one')).versions, ['1.1.0'])
})

test('reports an ok status for a writable directory', async () =>
{
    const registry = new LocalNpmRegistry(new FakeStorage())

    assert.equal((await registry.Test()).Ok, true)
})
