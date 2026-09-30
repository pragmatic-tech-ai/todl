import test from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectSharedBagPersister, ProjectLocalBagPersister } from '../project-bag-persisters.js'
import { BagScope } from '../bag-address.js'

test('project-local bags land in project.local.json, never the shared manifest', async () =>
{
    const storage = new FakeStorage('/p')
    await storage.WriteText('project.plexus', JSON.stringify({ type: 'architecture', name: 'a' }))
    const local = await ProjectLocalBagPersister.Open(storage)
    assert.equal(local.Scope, BagScope.Project)
    local.Create('npm-connection', 'gh').SetValue('DisplayName', 'GH')
    await local.Flush()
    const manifest = JSON.parse(await storage.ReadText('project.plexus'))
    assert.equal(manifest.bags, undefined)                       // manifest untouched
    const sidecar = JSON.parse(await storage.ReadText('project.local.json'))
    assert.equal(sidecar['npm-connection'].gh.DisplayName, 'GH')
})

test('project-shared bags persist in the manifest bags section, preserving other fields', async () =>
{
    const storage = new FakeStorage('/p')
    await storage.WriteText('project.plexus', JSON.stringify({ type: 'architecture', name: 'a', metaModels: [{ id: 'x', version: '1' }] }))
    const shared = await ProjectSharedBagPersister.Open(storage)
    shared.Create('proj-setting', 'main').SetValue('theme', 'dark')
    await shared.Flush()
    const manifest = JSON.parse(await storage.ReadText('project.plexus'))
    assert.equal(manifest.bags['proj-setting'].main.theme, 'dark')
    assert.deepEqual(manifest.metaModels, [{ id: 'x', version: '1' }])   // preserved
    assert.equal(manifest.name, 'a')
})

test('both read empty when their file/section is absent (defensive)', async () =>
{
    const storage = new FakeStorage('/p')
    const local = await ProjectLocalBagPersister.Open(storage)          // no sidecar
    assert.deepEqual(local.Ids('npm-connection'), [])
    await storage.WriteText('project.plexus', JSON.stringify({ type: 'architecture', name: 'a' }))
    const shared = await ProjectSharedBagPersister.Open(storage)        // no bags section
    assert.deepEqual(shared.Ids('anything'), [])
})
