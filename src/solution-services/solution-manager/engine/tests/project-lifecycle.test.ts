import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage, ConfirmAsk, type IPromptService, type IServiceProvider, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionManagerService } from '../solution-manager-service.js'
import { type IStorageProviderRegistry, type IProjectFactoryRegistry } from '../host-services.js'
import { FakeProjectFactory } from './fake-project-factory.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../project-services/core/project-factory.js'
import { ProjectEventsKey, ProjectEventKind, ProjectEvents, type ProjectEvent } from '../../../project-services/generators/project-events.js'
import { ProjectType, parseManifest } from '../../../package-manager/manifest.js'
import { ProjectLifecycle, CreateError, OpenError, type IProjectSessionStore, type IProjectRecents, type ICloseGuard } from '../project-lifecycle.js'
import { type Project } from '../../../project-services/core/project.js'

// A factory whose createProject writes a real manifest, as a TODL factory does.
class ManifestWritingFactory extends FakeProjectFactory
{
    constructor(private readonly bus?: ProjectEvents)
    {
        super()
    }

    public override async createProject(storage: IStorage, name: string): Promise<Project>
    {
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', name, version: 1 }))
        const project = await super.createProject(storage, name)
        // Like TodlProjectFactory, raise Created itself.
        const manifest = parseManifest(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
        await this.bus?.Raise({ Kind: ProjectEventKind.Created, ProjectType: manifest.type, Project: storage, Manifest: manifest })
        return project
    }
}

class MemorySession implements IProjectSessionStore
{
    public readonly folders: string[] = []
    public async List(): Promise<readonly string[]> { return [...this.folders] }
    public async Add(folder: string): Promise<void> { if (!this.folders.includes(folder)) this.folders.push(folder) }
    public async Remove(folder: string): Promise<void>
    {
        const i = this.folders.indexOf(folder)
        if (i >= 0) this.folders.splice(i, 1)
    }
}

class RecordingRecents implements IProjectRecents
{
    public readonly paths: string[] = []
    public async Add(entry: { path: string }): Promise<void> { this.paths.push(entry.path) }
}

class Harness
{
    public readonly roots = new Map<string, FakeStorage>()
    public readonly events: ProjectEvent[] = []
    public readonly session = new MemorySession()
    public readonly recents = new RecordingRecents()
    public readonly manager: SolutionManagerService
    public readonly lifecycle: ProjectLifecycle

    constructor()
    {
        const storages: IStorageProviderRegistry = {
            CreateStorage: (folder) =>
            {
                const s = this.roots.get(folder) ?? new FakeStorage(folder)
                this.roots.set(folder, s)
                return s
            },
        }
        const bus = new ProjectEvents()
        bus.Subscribe(async (e) => { this.events.push(e) })
        const factories: IProjectFactoryRegistry = {
            factoryFor: (type) => (type === 'architecture' ? new ManifestWritingFactory(bus) : undefined),
            All: () => [],
        }
        const prompts = { Ask: async (r: unknown) => (r instanceof ConfirmAsk ? true : undefined) } as unknown as IPromptService
        const provider = {
            get: (token: unknown) => (token === ProjectEventsKey ? bus : undefined),
            getRequired: (token: unknown) =>
            {
                if (token === SolutionManagerService.StorageRegistryKey) return storages
                if (token === SolutionManagerService.ProjectFactoryRegistryKey) return factories
                if (token === SolutionManagerService.PromptServiceKey) return prompts
                if (token === SolutionManagerService.PackageSourceKey) return {}
                throw new Error('unexpected service key')
            },
            has: () => true,
        } as unknown as IServiceProvider
        this.manager = new SolutionManagerService(provider)
        this.lifecycle = new ProjectLifecycle(provider, this.manager, this.session, this.recents)
    }

    public Seed(folder: string, type = 'architecture'): Promise<void>
    {
        const s = this.roots.get(folder) ?? new FakeStorage(folder)
        this.roots.set(folder, s)
        return s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type, name: 'p', version: 1 }))
    }
}

test('CreateProject into an empty folder creates, opens, tracks and raises Created exactly once', async () =>
{
    const h = new Harness()
    const out = await h.lifecycle.CreateProject({ type: ProjectType.Architecture, name: 'api', location: '/work', bindings: {} })
    assert.equal(out.created, true)
    if (!out.created) return
    assert.equal(out.folder, '/work/api')
    assert.equal(out.name, 'api')
    assert.equal(out.type, ProjectType.Architecture)
    assert.equal(h.manager.ActiveSolution!.Members.ToArray().includes(out.member), true)
    assert.deepEqual(h.events.map((e) => e.Kind), [ProjectEventKind.Created])
    assert.deepEqual(h.recents.paths, ['/work/api'])
    assert.deepEqual(h.session.folders, ['/work/api'])
})

test('CreateProject into a folder that already has a manifest is refused', async () =>
{
    const h = new Harness()
    await h.Seed('/work/api')
    const out = await h.lifecycle.CreateProject({ type: ProjectType.Architecture, name: 'api', location: '/work', bindings: {} })
    assert.deepEqual(out, { created: false, error: CreateError.FolderHasManifest })
    assert.equal(h.events.length, 0)
})

test('CreateProject with an unknown type or a blank name returns a typed error', async () =>
{
    const h = new Harness()
    const none = await h.lifecycle.CreateProject({ type: ProjectType.Library, name: 'x', location: '/work', bindings: {} })
    assert.deepEqual(none, { created: false, error: CreateError.NoFactory })
    const blank = await h.lifecycle.CreateProject({ type: ProjectType.Architecture, name: '  ', location: '/work', bindings: {} })
    assert.deepEqual(blank, { created: false, error: CreateError.Invalid })
})

test('OpenProjectAt opens, raises Opened, and dedupes', async () =>
{
    const h = new Harness()
    await h.Seed('/work/api')
    const first = await h.lifecycle.OpenProjectAt('/work/api')
    assert.equal(first.opened, true)
    assert.deepEqual(h.events.map((e) => e.Kind), [ProjectEventKind.Opened])
    const again = await h.lifecycle.OpenProjectAt('/work/api')
    assert.deepEqual(again, { opened: false, error: OpenError.AlreadyOpen })
})

test('CloseProject with a guard returning false does not close', async () =>
{
    const h = new Harness()
    await h.Seed('/work/api')
    const out = await h.lifecycle.OpenProjectAt('/work/api')
    assert.equal(out.opened, true)
    if (!out.opened) return
    const veto: ICloseGuard = { CanClose: async () => false }
    assert.equal(await h.lifecycle.CloseProject(out.member, veto), false)
    assert.equal(h.manager.ActiveSolution!.Members.ToArray().length, 1)
    assert.equal(h.events.some((e) => e.Kind === ProjectEventKind.MemberRemoved), false)
})

test('CloseProject without a veto closes, untracks and raises MemberRemoved', async () =>
{
    const h = new Harness()
    await h.Seed('/work/api')
    const out = await h.lifecycle.OpenProjectAt('/work/api')
    if (!out.opened) throw new Error('open failed')
    const allow: ICloseGuard = { CanClose: async () => true }
    assert.equal(await h.lifecycle.CloseProject(out.member, allow), true)
    assert.equal(h.manager.ActiveSolution!.Members.ToArray().length, 0)
    assert.deepEqual(h.session.folders, [])
    assert.equal(h.events.at(-1)!.Kind, ProjectEventKind.MemberRemoved)
})

test('RestoreSession reopens stored folders and prunes those with no manifest', async () =>
{
    const h = new Harness()
    await h.Seed('/work/api')
    await h.session.Add('/work/api')
    await h.session.Add('/work/gone')
    await h.lifecycle.RestoreSession()
    assert.equal(h.manager.ActiveSolution!.Members.ToArray().length, 1)
    assert.deepEqual(h.session.folders, ['/work/api'])
})

test('RestoreSession skips a corrupt project, restores the rest, and raises Opened', async () =>
{
    const h = new Harness()
    await h.Seed('/work/api')
    const bad = new FakeStorage('/work/bad')
    h.roots.set('/work/bad', bad)
    await bad.WriteText(PROJECT_MANIFEST_FILENAME, '{ not json')
    await h.session.Add('/work/bad')
    await h.session.Add('/work/api')
    await h.lifecycle.RestoreSession()
    assert.equal(h.manager.ActiveSolution!.Members.ToArray().length, 1)
    assert.deepEqual(h.events.map((e) => e.Kind), [ProjectEventKind.Opened])
})
