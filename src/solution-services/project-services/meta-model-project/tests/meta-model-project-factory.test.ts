import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { NodeFsStorage } from '@pragmatic-tech-ai/todl-runtime/node'
import { ProjectNodeKind } from '../../core/project.js'
import { MetaModelProjectFactory } from '../meta-model-project-factory.js'

const META = 'namespace acme { concept Widget { label : string?; } }'

async function tempDir(t: TestContext): Promise<NodeFsStorage>
{
    const dir = await mkdtemp(join(tmpdir(), 'todl-mm-'))
    t.after(async () => { await rm(dir, { recursive: true, force: true }) })
    return new NodeFsStorage(dir)
}

function factory(provider: ServiceProvider = new ServiceProvider()): MetaModelProjectFactory
{
    return new MetaModelProjectFactory(provider)
}

test('declares the meta-model type and .todl format', () => {
    const f = factory()
    assert.equal(MetaModelProjectFactory.ProjectType, 'meta-model')
    assert.equal(f.formats[0]!.extension, '.todl')
    assert.equal(f.formats[0]!.kind, ProjectNodeKind.Todl)
    assert.equal(f.typeId, 'meta-model')
})

test('createProject writes id/packageVersion and the meta-model scaffold', async (t) => {
    const storage = await tempDir(t)
    await factory().createProject(storage, 'My Model')
    const m = JSON.parse(await storage.ReadText('project.plexus'))
    assert.equal(m.type, 'meta-model')
    assert.equal(m.id, 'my-model')
    assert.equal(m.packageVersion, '0.1.0')
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

// The former publish() tests (bakes + persists model.json/bundle.json; blocked on a
// missing icon; blocked on an empty project) are retired — coverage moved to the build
// pipeline: emit-bundle-action / bake-resources-action / publish-package-action /
// solution-build tests.
