import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ServiceProvider, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { NodeFsStorage } from '@pragmatic-tech-ai/todl-runtime/node'
import { ProjectNodeKind } from '../../core/project.js'
import { PresentationBakerKey } from '../../core/presentation-baker.js'
import { PackageStoreKey, StoragePackageStore } from '../../../build-services/package-store.js'
import { LibraryProjectFactory } from '../library-project-factory.js'
import { FakePresentationBaker } from '../../core/tests/fake-producer-seams.js'

const LIB = 'namespace lib { concept Foo { label : string?; } }'
const META_REF = { id: 'mm', version: '0.1.0' }

async function tempDir(t: TestContext): Promise<NodeFsStorage>
{
    const dir = await mkdtemp(join(tmpdir(), 'todl-lib-'))
    t.after(async () => { await rm(dir, { recursive: true, force: true }) })
    return new NodeFsStorage(dir)
}

function providerWith(baker: FakePresentationBaker, store: IStorage): ServiceProvider
{
    const p = new ServiceProvider()
    p.registerInstance(PresentationBakerKey, baker)
    p.registerInstance(PackageStoreKey, new StoragePackageStore(store))
    return p
}

function factory(provider: ServiceProvider = new ServiceProvider()): LibraryProjectFactory
{
    return new LibraryProjectFactory(provider)
}

test('declares the library type, meta-model need, and .todl format', () => {
    const f = factory()
    assert.equal(LibraryProjectFactory.ProjectType, 'library')
    assert.equal(f.requiresMetaModel, true)
    assert.equal(f.formats[0]!.kind, ProjectNodeKind.Todl)
    assert.equal(f.typeId, 'library')
})

test('createProject binds the meta-models and writes id/packageVersion + scaffold', async (t) => {
    const storage = await tempDir(t)
    await factory().createProject(storage, 'AWS Lib', { metaModels: [META_REF] })
    const m = JSON.parse(await storage.ReadText('project.plexus'))
    assert.equal(m.type, 'library')
    assert.equal(m.id, 'aws-lib')
    assert.equal(m.packageVersion, '0.1.0')
    assert.deepEqual(m.metaModels, [META_REF])
    assert.match(await storage.ReadText('CLAUDE.md'), /library/i)
})

test('getVersion / setVersion round-trip through the manifest', async (t) => {
    const storage = await tempDir(t)
    const f = factory()
    await f.createProject(storage, 'L', { metaModels: [META_REF] })
    assert.equal(await f.getVersion(storage), '0.1.0')
    await f.setVersion(storage, '9.9.9')
    assert.equal(await f.getVersion(storage), '9.9.9')
})

test('publish is blocked when no meta-model is bound', async (t) => {
    const project = await tempDir(t)
    const provider = providerWith(new FakePresentationBaker(), await tempDir(t))
    const f = factory(provider)
    await f.createProject(project, 'L')      // no bindings
    await project.WriteText('taxonomy.todl', LIB)
    const result = await f.publish(await f.openProject(project), project, provider)
    assert.equal(result.ok, false)
    assert.match(result.message, /meta-model binding/i)
})

test('publish is blocked when the bound meta-model is not published', async (t) => {
    const project = await tempDir(t)
    const store = await tempDir(t)      // empty — the base cannot resolve
    const provider = providerWith(new FakePresentationBaker(), store)
    const f = factory(provider)
    await f.createProject(project, 'L', { metaModels: [META_REF] })
    await project.WriteText('taxonomy.todl', LIB)
    const result = await f.publish(await f.openProject(project), project, provider)
    assert.equal(result.ok, false)
    assert.match(result.message, /not published/i)
})

test('publish bakes, persists model.json + bundle.json, and writes the generated presentation', async (t) => {
    const project = await tempDir(t)
    const store = await tempDir(t)
    // Seed the bound meta-model so RecursiveProjectReferencesResolver resolves it.
    await store.WriteText('mm/0.1.0/model.json', JSON.stringify({ nodes: [], edges: [] }))

    const baker = new FakePresentationBaker({ ok: true, icons: 2 })
    const provider = providerWith(baker, store)
    const f = factory(provider)
    await f.createProject(project, 'AWS', { metaModels: [META_REF] })
    await project.WriteText('taxonomy.todl', LIB)
    const result = await f.publish(await f.openProject(project), project, provider)

    assert.equal(result.ok, true)
    assert.match(result.message, /Published aws@0\.1\.0/)
    assert.equal(baker.calls[0]!.options.dictName, 'LibraryPresentation')
    assert.equal(baker.calls[0]!.options.iconPrefix, '')
    assert.equal(await store.Exists('aws/0.1.0/model.json'), true)
    assert.equal(await store.Exists('aws/0.1.0/bundle.json'), true)
    assert.equal(await project.Exists('presentation.generated.mu'), true)
})
