import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ServiceProvider, Disposable, type IServiceProvider, type IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import { NodeFsStorage } from '@pragmatic-tech-ai/todl-runtime/node'
import {
    PROJECT_MANIFEST_FILENAME,
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
    type IProjectFactory,
} from '../project-factory.js'
import { type ProjectBaseModelBindings } from '../base-binding.js'
import { ProjectNodeKind } from '../project.js'
import { TodlProjectFactory, isTodlProject, type ScaffoldFile } from '../todl-project-factory.js'
import { ProjectEventsKey, ProjectEventKind, type ProjectEvent, type IProjectEvents, type ProjectEventHandler } from '../../generators/project-events.js'

// A real filesystem storage rooted at a throwaway temp dir, torn down after the test.
async function tempStorage(t: TestContext): Promise<NodeFsStorage>
{
    const dir = await mkdtemp(join(tmpdir(), 'todl-factory-'))
    t.after(async () => { await rm(dir, { recursive: true, force: true }) })
    return new NodeFsStorage(dir)
}

// A minimal concrete factory: one extra scaffold file, a manifest carrying an
// unrelated field to prove saveProject preserves it, and two formats so the
// kind-mapping is exercised (.todl → Todl, .diagram → Diagram).
class FakeFactory extends TodlProjectFactory
{
    public readonly typeId = 'fake'
    public readonly title = 'Fake Project'
    public readonly description = ''
    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.diagram', kind: ProjectNodeKind.Diagram, displayName: 'Diagram' },
        { extension: '.todl', kind: ProjectNodeKind.Todl, displayName: 'TODL Definition' },
    ]
    protected buildManifest(name: string, _bindings?: ProjectBaseModelBindings): ProjectManifestEnvelope
    {
        return { type: 'fake', name, version: 1, keep: 'me' } as ProjectManifestEnvelope & { keep: string }
    }
    protected scaffoldContributions(): readonly ScaffoldFile[]
    {
        return [{ path: 'CLAUDE.md', content: 'FAKE ROOT' }]
    }
}

function factory(): FakeFactory { return new FakeFactory(new ServiceProvider()) }

// A fake events sink recording every raised event, for asserting createProject's
// create-time Created raise without a real ProjectEvents bus.
class FakeProjectEvents implements IProjectEvents
{
    public readonly Raised: ProjectEvent[] = []
    private readonly handlers: ProjectEventHandler[] = []
    public async Raise(event: ProjectEvent): Promise<void> { this.Raised.push(event) }
    public Subscribe(handler: ProjectEventHandler): IDisposable
    {
        this.handlers.push(handler)
        return new Disposable(() => { const i = this.handlers.indexOf(handler); if (i !== -1) this.handlers.splice(i, 1) })
    }
}

function factoryWithEvents(): { factory: FakeFactory, events: FakeProjectEvents }
{
    const events = new FakeProjectEvents()
    const provider = new ServiceProvider()
    provider.registerInstance(ProjectEventsKey, events)
    return { factory: new FakeFactory(provider), events }
}

test('createProject writes base scaffold ∪ subclass contribution', async (t) => {
    const storage = await tempStorage(t)
    await factory().createProject(storage, 'P')
    assert.equal(await storage.Exists('.claude/todl-manual.md'), true)
    assert.equal(await storage.Exists('.claude/todl-rules.md'), true)
    assert.equal(await storage.ReadText('CLAUDE.md'), 'FAKE ROOT')
    assert.match(await storage.ReadText('.claude/todl-manual.md'), /namespace/)
    assert.match(await storage.ReadText('.claude/todl-rules.md'), /golden rules/i)
})

test('createProject scaffolds a .gitignore that ignores the project-local bag sidecar', async (t) => {
    const storage = await tempStorage(t)
    await factory().createProject(storage, 'P')
    assert.equal(await storage.Exists('.gitignore'), true)
    assert.match(await storage.ReadText('.gitignore'), /project\.local\.json/)
})

test('scaffolding a project that already has a .gitignore appends the sidecar rule, preserving author rules', async (t) => {
    const storage = await tempStorage(t)
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'fake', name: 'P', version: 1 }))
    await storage.WriteText('.gitignore', 'node_modules/\ndist/\n')
    await factory().openProject(storage)
    const gi = await storage.ReadText('.gitignore')
    assert.match(gi, /node_modules\//)          // author rule preserved
    assert.match(gi, /dist\//)
    assert.match(gi, /project\.local\.json/)     // sidecar rule appended
})

test('ensureGitignore is idempotent — a second scaffold does not duplicate the rule', async (t) => {
    const storage = await tempStorage(t)
    await factory().createProject(storage, 'P')
    await factory().openProject(storage)         // scaffold runs again
    const occurrences = (await storage.ReadText('.gitignore')).split(/\r?\n/).filter((l) => l.trim() === 'project.local.json').length
    assert.equal(occurrences, 1)
})

test('updateScaffold never clobbers a hand-maintained .gitignore', async (t) => {
    const storage = await tempStorage(t)
    await factory().createProject(storage, 'P')
    await storage.WriteText('.gitignore', 'node_modules/\ncustom-rule\n')   // author replaces it
    await factory().updateScaffold(storage)
    const gi = await storage.ReadText('.gitignore')
    assert.match(gi, /custom-rule/)              // preserved, not overwritten
    assert.match(gi, /project\.local\.json/)     // still ensured
})

test('ensureScaffold is write-once (never clobbers an author edit)', async (t) => {
    const storage = await tempStorage(t)
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'fake', name: 'P', version: 1 }))
    await storage.WriteText('.claude/todl-manual.md', 'MY EDIT')
    await factory().openProject(storage)
    assert.equal(await storage.ReadText('.claude/todl-manual.md'), 'MY EDIT')     // preserved
    assert.equal(await storage.Exists('.claude/todl-rules.md'), true)             // missing one filled
})

test('populate maps node kind from formats; unmatched → file; manifest hidden', async (t) => {
    const storage = await tempStorage(t)
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'fake', name: 'P', version: 1 }))
    await storage.WriteText('defs/core.todl', 'namespace d {}')
    await storage.WriteText('view.diagram', '{}')
    await storage.WriteText('notes.md', 'hi')
    const project = await factory().openProject(storage)
    const top = new Map(project.Root.Children.ToArray().map((n) => [n.Name, n.Kind]))
    assert.equal(top.get('view.diagram'), ProjectNodeKind.Diagram)
    assert.equal(top.get('notes.md'), ProjectNodeKind.File)
    assert.equal([...top.keys()].includes(PROJECT_MANIFEST_FILENAME), false)
    const defs = project.Root.Children.ToArray().find((n) => n.Name === 'defs')!
    assert.equal(defs.Kind, ProjectNodeKind.Folder)
    assert.equal(defs.Children.ToArray()[0]!.Kind, ProjectNodeKind.Todl)
    assert.equal(defs.Children.ToArray()[0]!.Path, 'defs/core.todl')
})

test('saveProject renames and preserves unrelated manifest fields', async (t) => {
    const storage = await tempStorage(t)
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'fake', name: 'Old', version: 1, keep: 'me' }))
    // Project.Name is read-only, so build the renamed project through the factory.
    const renamed = await factory().createProject(await tempStorage(t), 'Renamed')
    await factory().saveProject(renamed, storage)
    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    assert.equal(m.name, 'Renamed')
    assert.equal(m.keep, 'me')      // untouched
})

test('updateScaffold refreshes .claude docs, preserves CLAUDE.md, self-heals missing', async (t) => {
    const storage = await tempStorage(t)
    const f = factory()
    await f.createProject(storage, 'P')                             // full scaffold + CLAUDE.md = 'FAKE ROOT'
    await storage.WriteText('.claude/todl-manual.md', 'HACKED')     // stale edit to a managed doc
    await storage.WriteText('CLAUDE.md', 'MY NOTES')               // author edit to the root
    await storage.Delete('.claude/todl-rules.md')                  // a missing managed doc

    const written = await f.updateScaffold(storage)

    assert.match(await storage.ReadText('.claude/todl-manual.md'), /namespace/)   // refreshed, not 'HACKED'
    assert.equal(await storage.ReadText('CLAUDE.md'), 'MY NOTES')                 // preserved
    assert.equal(await storage.Exists('.claude/todl-rules.md'), true)            // self-healed
    assert.equal(written.includes('.claude/todl-manual.md'), true)
    assert.equal(written.includes('.claude/todl-rules.md'), true)
    assert.equal(written.includes('CLAUDE.md'), false)
})

test('isTodlProject is true for a subclass, false for a plain factory', () => {
    assert.equal(isTodlProject(factory()), true)
    assert.equal(isTodlProject({ formats: [] } as unknown as IProjectFactory), false)
})

test('createProject raises a Created event when an events sink is registered', async (t) => {
    const storage = await tempStorage(t)
    const { factory: f, events } = factoryWithEvents()
    await f.createProject(storage, 'P')
    assert.equal(events.Raised.length, 1)
    const [event] = events.Raised
    assert.equal(event!.Kind, ProjectEventKind.Created)
    assert.equal(event!.ProjectType, 'fake')
    assert.equal(event!.Manifest.name, 'P')
    assert.equal(event!.Manifest.type, 'fake')
})

test('createProject raises nothing when no events sink is registered', async (t) => {
    const storage = await tempStorage(t)
    const project = await factory().createProject(storage, 'P')
    assert.equal(project.Name, 'P')     // completes normally; no throw
})
