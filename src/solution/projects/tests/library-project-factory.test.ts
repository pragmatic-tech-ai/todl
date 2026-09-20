import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ServiceProvider, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { NodeFsStorage } from '@pragmatic-tech-ai/todl-runtime/node'
import { ProjectNodeKind } from '../project.js'
import { PresentationBakerKey } from '../presentation-baker.js'
import { ProducerBackendsKey } from '../producer-backends.js'
import { LibraryProjectFactory } from '../library-project-factory.js'
import { FakePresentationBaker, FakeProducerBackends } from './fake-producer-seams.js'

const LIB = 'namespace lib { concept Foo { label : string?; } }'
const META_REF = { id: 'mm', version: '0.1.0' }

async function tempDir(t: TestContext): Promise<NodeFsStorage>
{
    const dir = await mkdtemp(join(tmpdir(), 'todl-lib-'))
    t.after(async () => { await rm(dir, { recursive: true, force: true }) })
    return new NodeFsStorage(dir)
}

function providerWith(baker: FakePresentationBaker, metaBackend: IStorage, libBackend: IStorage): ServiceProvider
{
    const p = new ServiceProvider()
    p.registerInstance(PresentationBakerKey, baker)
    p.registerInstance(ProducerBackendsKey, new FakeProducerBackends(metaBackend, libBackend))
    return p
}

function factory(provider: ServiceProvider = new ServiceProvider()): LibraryProjectFactory
{
    return new LibraryProjectFactory(provider)
}

test('declares the library type, meta-model need, .todl format, producer kind', () => {
    const f = factory()
    assert.equal(LibraryProjectFactory.ProjectType, 'library')
    assert.equal(f.requiresMetaModel, true)
    assert.equal(f.formats[0]!.kind, ProjectNodeKind.Todl)
    assert.equal(f.producerKind, 'library')
})

test('createProject binds the meta-model and writes id/libVersion + scaffold', async (t) => {
    const storage = await tempDir(t)
    await factory().createProject(storage, 'AWS Lib', { metaModel: META_REF })
    const m = JSON.parse(await storage.ReadText('project.plexus'))
    assert.equal(m.type, 'library')
    assert.equal(m.id, 'aws-lib')
    assert.equal(m.libVersion, '0.1.0')
    assert.deepEqual(m.metaModel, META_REF)
    assert.match(await storage.ReadText('CLAUDE.md'), /library/i)
})

test('getVersion / setVersion round-trip through the manifest', async (t) => {
    const storage = await tempDir(t)
    const f = factory()
    await f.createProject(storage, 'L', { metaModel: META_REF })
    assert.equal(await f.getVersion(storage), '0.1.0')
    await f.setVersion(storage, '9.9.9')
    assert.equal(await f.getVersion(storage), '9.9.9')
})

test('publish is blocked when no meta-model is bound', async (t) => {
    const project = await tempDir(t)
    const provider = providerWith(new FakePresentationBaker(), await tempDir(t), await tempDir(t))
    const f = factory(provider)
    await f.createProject(project, 'L')      // no bindings
    await project.WriteText('taxonomy.todl', LIB)
    const result = await f.publish(await f.openProject(project), project, provider)
    assert.equal(result.ok, false)
    assert.match(result.message, /meta-model binding/i)
})

test('publish is blocked when the bound meta-model is not published', async (t) => {
    const project = await tempDir(t)
    const metaBackend = await tempDir(t)      // empty — the base cannot resolve
    const provider = providerWith(new FakePresentationBaker(), metaBackend, await tempDir(t))
    const f = factory(provider)
    await f.createProject(project, 'L', { metaModel: META_REF })
    await project.WriteText('taxonomy.todl', LIB)
    const result = await f.publish(await f.openProject(project), project, provider)
    assert.equal(result.ok, false)
    assert.match(result.message, /not published/i)
})

test('publish bakes, persists model.json + library.json, and writes the generated presentation', async (t) => {
    const project = await tempDir(t)
    const metaBackend = await tempDir(t)
    const libBackend = await tempDir(t)
    // Seed the bound meta-model so BaseResolver resolves it.
    await metaBackend.WriteText('mm/0.1.0/model.json', JSON.stringify({ nodes: [], edges: [] }))

    const baker = new FakePresentationBaker({ ok: true, icons: 2 })
    const provider = providerWith(baker, metaBackend, libBackend)
    const f = factory(provider)
    await f.createProject(project, 'AWS', { metaModel: META_REF })
    await project.WriteText('taxonomy.todl', LIB)
    const result = await f.publish(await f.openProject(project), project, provider)

    assert.equal(result.ok, true)
    assert.match(result.message, /Published aws@0\.1\.0/)
    assert.equal(baker.calls[0]!.options.dictName, 'LibraryPresentation')
    assert.equal(baker.calls[0]!.options.iconPrefix, '')
    assert.equal(await libBackend.Exists('aws/0.1.0/model.json'), true)
    assert.equal(await libBackend.Exists('aws/0.1.0/library.json'), true)
    assert.equal(await project.Exists('presentation.generated.mu'), true)
})
