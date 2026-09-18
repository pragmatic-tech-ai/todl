import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { NodeFsStorage } from '@pragmatic-tech-ai/todl-runtime/node'
import { ProjectNodeKind } from '../project.js'
import { ArchitectureProjectFactory } from '../architecture-project-factory.js'

async function tempStorage(t: TestContext): Promise<NodeFsStorage> {
    const dir = await mkdtemp(join(tmpdir(), 'todl-arch-'))
    t.after(async () => { await rm(dir, { recursive: true, force: true }) })
    return new NodeFsStorage(dir)
}

function factory(): ArchitectureProjectFactory {
    return new ArchitectureProjectFactory(new ServiceProvider())
}

test('declares the architecture type, base needs, and .diagram/.todl formats', () => {
    const f = factory()
    assert.equal(ArchitectureProjectFactory.ProjectType, 'architecture')
    assert.equal(f.requiresMetaModel, true)
    assert.equal(f.offersLibraries, true)
    const kinds = new Map(f.formats.map((fmt) => [fmt.extension, fmt.kind]))
    assert.equal(kinds.get('.diagram'), ProjectNodeKind.Diagram)
    assert.equal(kinds.get('.todl'), ProjectNodeKind.Todl)
})

test('createProject writes the bound meta-model and libraries into the manifest', async (t) => {
    const storage = await tempStorage(t)
    await factory().createProject(storage, 'Acme', {
        metaModel: { id: 'tech-architecture', version: '1.2.0' },
        libraries: [{ id: 'aws', version: '3.0.0' }, { id: 'microsoft', version: '2.1.0' }],
    })
    const m = JSON.parse(await storage.ReadText('project.plexus'))
    assert.equal(m.type, 'architecture')
    assert.equal(m.name, 'Acme')
    assert.deepEqual(m.metaModel, { id: 'tech-architecture', version: '1.2.0' })
    assert.deepEqual(m.libraries, [{ id: 'aws', version: '3.0.0' }, { id: 'microsoft', version: '2.1.0' }])
})

test('createProject omits empty base bindings from the manifest', async (t) => {
    const storage = await tempStorage(t)
    await factory().createProject(storage, 'Bare', { libraries: [] })
    const m = JSON.parse(await storage.ReadText('project.plexus'))
    assert.equal('metaModel' in m, false)
    assert.equal('libraries' in m, false)
})

test('createProject lays down the architecture CLAUDE.md over the shared TODL scaffold', async (t) => {
    const storage = await tempStorage(t)
    await factory().createProject(storage, 'P')
    assert.match(await storage.ReadText('CLAUDE.md'), /Architecture project/i)
    assert.equal(await storage.Exists('.claude/todl-manual.md'), true)
    assert.equal(await storage.Exists('.claude/todl-rules.md'), true)
})
