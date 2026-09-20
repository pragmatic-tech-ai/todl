import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ServiceProvider, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { NodeFsStorage } from '@pragmatic-tech-ai/todl-runtime/node'
import { Solution } from '../solution.js'
import { MetaModelProjectFactory } from '../../projects/meta-model-project-factory.js'
import { LibraryProjectFactory } from '../../projects/library-project-factory.js'
import { type Project, type ProjectNode } from '../../projects/project.js'
import { type IProjectFactory } from '../../projects/project-factory.js'

// Integration tests that load the REAL on-disk projects under TODL/test_projects
// (a meta-model + two libraries) through the actual project factories and the
// Solution member-open path — the same route a shell takes when it opens a
// solution. openProject self-heals its .claude scaffold (it WRITES into the
// project storage), so each fixture is copied into a throwaway temp dir first;
// the repo's test_projects is never mutated.

const TEST_PROJECTS = join(dirname(fileURLToPath(import.meta.url)), '../../../../test_projects')

const META_MODEL = 'meta-models/tech-architecture'
const AWS_LIBRARY = 'libraries/aws'
const MICROSOFT_LIBRARY = 'libraries/microsoft'

// Copy one test_projects subfolder into a fresh temp dir and root a NodeFsStorage
// at it, so opening the project (which writes scaffold) leaves the fixture intact.
async function copyProject(t: TestContext, relPath: string): Promise<NodeFsStorage>
{
    const dir = await mkdtemp(join(tmpdir(), 'todl-testproj-'))
    await cp(join(TEST_PROJECTS, relPath), dir, { recursive: true })
    t.after(async () =>
    {
        await rm(dir, { recursive: true, force: true })
    })
    return new NodeFsStorage(dir)
}

// Depth-first search of a project's node tree for the first node matching `match`.
function findNode(node: ProjectNode, match: (n: ProjectNode) => boolean): ProjectNode | undefined
{
    if (match(node)) return node
    for (const child of node.Children)
    {
        const hit = findNode(child, match)
        if (hit !== undefined) return hit
    }
    return undefined
}

// A project has a `.todl` source somewhere in its tree.
function hasTodlSource(root: ProjectNode): boolean
{
    return findNode(root, (n) => n.Name.endsWith('.todl')) !== undefined
}

test('loads the meta-model and library projects from test_projects', async (t) =>
{
    const metaFactory = new MetaModelProjectFactory(new ServiceProvider())
    const libraryFactory = new LibraryProjectFactory(new ServiceProvider())

    const metaModel = await metaFactory.openProject(await copyProject(t, META_MODEL))
    assert.equal(metaModel.Type, 'meta-model')
    assert.ok(hasTodlSource(metaModel.Root), 'meta-model has .todl concepts')

    const aws = await libraryFactory.openProject(await copyProject(t, AWS_LIBRARY))
    assert.equal(aws.Type, 'library')
    assert.ok(findNode(aws.Root, (n) => n.Name === 'aws.todl'), 'aws library has aws.todl')

    const microsoft = await libraryFactory.openProject(await copyProject(t, MICROSOFT_LIBRARY))
    assert.equal(microsoft.Type, 'library')
    assert.ok(hasTodlSource(microsoft.Root), 'microsoft library has a .todl source')
})

test('loads the meta-model into a solution as a member', async (t) =>
{
    const metaFactory = new MetaModelProjectFactory(new ServiceProvider())
    const metaStorage = await copyProject(t, META_MODEL)

    const solution = new Solution('Test Solution')
    solution.AddMember('meta-model', 'meta-model')
    solution.IsDirty = false

    await solution.OpenMembers(
        () => metaStorage,
        (type) => (type === 'meta-model' ? metaFactory : undefined),
    )

    const member = solution.Members.ToArray()[0]!
    assert.equal(member.IsResolved, true)
    assert.equal((member.Project as Project).Type, 'meta-model')
})

test('loads the meta-model and its libraries into a solution', async (t) =>
{
    const metaFactory = new MetaModelProjectFactory(new ServiceProvider())
    const libraryFactory = new LibraryProjectFactory(new ServiceProvider())

    const metaStorage = await copyProject(t, META_MODEL)
    const awsStorage = await copyProject(t, AWS_LIBRARY)
    const microsoftStorage = await copyProject(t, MICROSOFT_LIBRARY)
    const storages = new Map<string, IStorage>([
        ['meta-model', metaStorage],
        ['aws', awsStorage],
        ['microsoft', microsoftStorage],
    ])
    const factoryFor = (type: string): IProjectFactory | undefined =>
    {
        if (type === 'meta-model') return metaFactory
        if (type === 'library') return libraryFactory
        return undefined
    }

    const solution = new Solution('Tech Architecture Solution')
    solution.AddMember('meta-model', 'meta-model')
    solution.AddMember('aws', 'library')
    solution.AddMember('microsoft', 'library')

    await solution.OpenMembers((path) => storages.get(path)!, factoryFor)

    const members = solution.Members.ToArray()
    assert.equal(members.length, 3)
    assert.ok(
        members.every((m) => m.IsResolved),
        'every member (meta-model + both libraries) resolved',
    )
    assert.deepEqual(
        members.map((m) => (m.Project as Project).Type),
        ['meta-model', 'library', 'library'],
    )

    // The libraries are authored against this meta-model: their manifest binds it by
    // id, so loading them together is a coherent meta-model + libraries set.
    const metaId = JSON.parse(await metaStorage.ReadText('project.plexus')).id as string
    for (const libStorage of [awsStorage, microsoftStorage])
    {
        const libManifest = JSON.parse(await libStorage.ReadText('project.plexus'))
        assert.equal(libManifest.metaModel.id, metaId)
    }
})
