import test from 'node:test'
import assert from 'node:assert/strict'
import { WikiOriginKind, WikiLocator } from '../wiki-origin.js'

// A minimal IStorage stand-in — only identity matters for these tests.
const projectStorage = { id: 'project' } as never
const packagesStorage = { id: 'packages' } as never

test('OpenProjectOrigin carries the storage', () =>
{
    assert.deepEqual(WikiLocator.OpenProjectOrigin(projectStorage), { kind: WikiOriginKind.OpenProject, storage: projectStorage })
})

test('PackageOrigin carries id + version (no backend field)', () =>
{
    assert.deepEqual(WikiLocator.PackageOrigin('microsoft', '1.2.0'), { kind: WikiOriginKind.Package, id: 'microsoft', version: '1.2.0' })
})

test('PackageWikiPath composes <id>/<version>/<relPath>', () =>
{
    assert.equal(WikiLocator.PackageWikiPath('microsoft', '1.2.0', 'wiki/service.md'), 'microsoft/1.2.0/wiki/service.md')
})

test('LocateFile — open-project origin returns the project storage + bare relPath', () =>
{
    const loc = WikiLocator.LocateFile(packagesStorage, WikiLocator.OpenProjectOrigin(projectStorage), 'wiki/service.md')
    assert.equal(loc.storage, projectStorage)
    assert.equal(loc.path, 'wiki/service.md')
})

test('LocateFile — package origin reads packagesStorage at <id>/<version>/<relPath>', () =>
{
    const loc = WikiLocator.LocateFile(packagesStorage, WikiLocator.PackageOrigin('ea', '0.1.0'), 'wiki/service.md')
    assert.equal(loc.storage, packagesStorage)
    assert.equal(loc.path, 'ea/0.1.0/wiki/service.md')
})
