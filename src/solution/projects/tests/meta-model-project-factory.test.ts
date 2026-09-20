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
import { MetaModelProjectFactory } from '../meta-model-project-factory.js'
import { FakePresentationBaker, FakeProducerBackends } from './fake-producer-seams.js'

const META = 'namespace acme { concept Widget { label : string?; } }'

async function tempDir(t: TestContext): Promise<NodeFsStorage>
{
    const dir = await mkdtemp(join(tmpdir(), 'todl-mm-'))
    t.after(async () => { await rm(dir, { recursive: true, force: true }) })
    return new NodeFsStorage(dir)
}

// A provider wiring the two producer seams to the given fakes.
function providerWith(baker: FakePresentationBaker, metaBackend: IStorage, libBackend: IStorage): ServiceProvider
{
    const p = new ServiceProvider()
    p.registerInstance(PresentationBakerKey, baker)
    p.registerInstance(ProducerBackendsKey, new FakeProducerBackends(metaBackend, libBackend))
    return p
}

function factory(provider: ServiceProvider = new ServiceProvider()): MetaModelProjectFactory
{
    return new MetaModelProjectFactory(provider)
}

test('declares the meta-model type, .todl format, and producer kind', () => {
    const f = factory()
    assert.equal(MetaModelProjectFactory.ProjectType, 'meta-model')
    assert.equal(f.formats[0]!.extension, '.todl')
    assert.equal(f.formats[0]!.kind, ProjectNodeKind.Todl)
    assert.equal(f.producerKind, 'meta-model')
})

test('createProject writes id/modelVersion and the meta-model scaffold', async (t) => {
    const storage = await tempDir(t)
    await factory().createProject(storage, 'My Model')
    const m = JSON.parse(await storage.ReadText('project.plexus'))
    assert.equal(m.type, 'meta-model')
    assert.equal(m.id, 'my-model')
    assert.equal(m.modelVersion, '0.1.0')
    assert.match(await storage.ReadText('CLAUDE.md'), /meta-model/i)
    assert.equal(await storage.Exists('.claude/meta-model-guide.md'), true)
    assert.equal(await storage.Exists('.claude/commands/new-concept.md'), true)
})

test('getVersion / setVersion round-trip through the manifest', async (t) => {
    const storage = await tempDir(t)
    const f = factory()
    await f.createProject(storage, 'M')
    assert.equal(await f.getVersion(storage), '0.1.0')
    await f.setVersion(storage, '2.5.0')
    assert.equal(await f.getVersion(storage), '2.5.0')
})

test('compileToDocument compiles the project .todl into a document', async (t) => {
    const storage = await tempDir(t)
    await factory().createProject(storage, 'M')
    await storage.WriteText('model.todl', META)
    const { doc, problems } = await factory().compileToDocument(storage, [], new ServiceProvider())
    assert.equal(problems.length, 0)
    assert.ok(doc.nodes.some((n) => n.id.includes('Widget')))
})

test('publish bakes, persists model.json + manifest.json, and writes the generated presentation', async (t) => {
    const project = await tempDir(t)
    const metaBackend = await tempDir(t)
    const libBackend = await tempDir(t)
    const baker = new FakePresentationBaker({ ok: true, icons: 3 })
    const provider = providerWith(baker, metaBackend, libBackend)

    const f = factory(provider)
    await f.createProject(project, 'Widgets')
    await project.WriteText('model.todl', META)
    const result = await f.publish(await f.openProject(project), project, provider)

    assert.equal(result.ok, true)
    assert.match(result.message, /Published widgets@0\.1\.0/)
    assert.equal(baker.calls.length, 1)
    assert.equal(baker.calls[0]!.options.dictName, 'MetaModelPresentation')
    assert.equal(baker.calls[0]!.options.iconPrefix, 'mm:')
    assert.equal(await metaBackend.Exists('widgets/0.1.0/model.json'), true)
    assert.equal(await metaBackend.Exists('widgets/0.1.0/manifest.json'), true)
    assert.equal(await project.Exists('presentation.generated.mu'), true)
})

test('publish is blocked (nothing written) when a referenced icon is missing', async (t) => {
    const project = await tempDir(t)
    const metaBackend = await tempDir(t)
    const baker = new FakePresentationBaker({ ok: false, missing: ['resources/x.svg'] })
    const provider = providerWith(baker, metaBackend, await tempDir(t))

    const f = factory(provider)
    await f.createProject(project, 'Widgets')
    await project.WriteText('model.todl', META)
    const result = await f.publish(await f.openProject(project), project, provider)

    assert.equal(result.ok, false)
    assert.match(result.message, /missing icon/i)
    assert.equal(await metaBackend.Exists('widgets/0.1.0/model.json'), false)   // nothing persisted
})

test('publish refuses an empty project', async (t) => {
    const project = await tempDir(t)
    const provider = providerWith(new FakePresentationBaker(), await tempDir(t), await tempDir(t))
    const f = factory(provider)
    await f.createProject(project, 'Empty')
    // createProject lays down no .todl; remove none — the project has only scaffold.
    const result = await f.publish(await f.openProject(project), project, provider)
    assert.equal(result.ok, false)
    assert.match(result.message, /no \.todl/i)
})
