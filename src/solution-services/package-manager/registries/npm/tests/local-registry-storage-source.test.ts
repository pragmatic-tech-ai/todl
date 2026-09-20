import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { LocalNpmRegistry } from '../local-npm-registry.js'
import { StoragePackageSource } from '../../../storage-package-source.js'
import { createTgz } from '../../../registry/index.js'
import { type PublishablePackage } from '../../../engine/package-registry.js'

const enc = new TextEncoder()

// A publishable package whose tarball carries a package/model.json — the exact file
// StoragePackageSource reads from the unpacked layout.
function publishable(name: string, version: string, model: unknown): PublishablePackage
{
    const manifest = { name, version }
    const tarball = createTgz([
        { path: 'package/package.json', bytes: enc.encode(JSON.stringify(manifest)) },
        { path: 'package/model.json', bytes: enc.encode(JSON.stringify(model)) },
    ])
    return { Manifest: manifest, Tarball: tarball }
}

// LocalNpmRegistry is the WRITE side of the on-disk layout StoragePackageSource
// reads: publishing through the registry lays down <name>/<version>/model.json, and
// a StoragePackageSource over the same storage discovers those versions and reads
// the model back.
test('a StoragePackageSource reads versions LocalNpmRegistry published', async () =>
{
    const storage = new FakeStorage()
    const registry = new LocalNpmRegistry(storage)
    await registry.Publish(publishable('@x/one', '1.0.0', { id: 'one' }))
    await registry.Publish(publishable('@x/one', '1.1.0', { id: 'one' }))

    const source = new StoragePackageSource(storage)

    assert.deepEqual([...(await source.versions('@x/one'))].sort(), ['1.0.0', '1.1.0'])
})

test('the published model.json lands where StoragePackageSource reads it', async () =>
{
    const storage = new FakeStorage()
    const registry = new LocalNpmRegistry(storage)
    await registry.Publish(publishable('@x/one', '1.0.0', { id: 'one', kind: 'concept' }))

    const model = JSON.parse(await storage.ReadText('@x/one/1.0.0/model.json'))
    assert.equal(model.kind, 'concept')
})
