import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { NodeFsStorage } from '@pragmatic-tech-ai/todl-runtime/node'
import { ProjectNodeKind } from '../../core/project.js'
import { LibraryProjectFactory } from '../library-project-factory.js'

const META_REF = { id: 'mm', version: '0.1.0' }

async function tempDir(t: TestContext): Promise<NodeFsStorage>
{
    const dir = await mkdtemp(join(tmpdir(), 'todl-lib-'))
    t.after(async () => { await rm(dir, { recursive: true, force: true }) })
    return new NodeFsStorage(dir)
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

// The former publish() tests (blocked with no meta-model bound; blocked when the bound
// meta-model is not published; bakes + persists model.json/bundle.json) are retired —
// coverage moved to the build pipeline: emit-bundle-action / bake-resources-action /
// publish-package-action / solution-build tests.
