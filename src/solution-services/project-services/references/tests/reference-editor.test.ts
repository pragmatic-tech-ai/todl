import test from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ReferenceEditor, ReferenceResolutionKind, type IPublishedBaseCatalog, type RefChoiceDTO } from '../reference-editor.js'
import { PROJECT_MANIFEST_FILENAME } from '../../core/project-factory.js'
import { ProjectType } from '../../../package-manager/manifest.js'
import { SolutionMember } from '../../../solution-manager/engine/solution-member.js'
import { ProjectEventKind, type IProjectEvents, type ProjectEvent } from '../../generators/project-events.js'

class FakeResolver
{
    public invalidated: string[] = []
    constructor(private readonly producers: RefChoiceDTO[]) {}
    public async WorkspaceProducers(_k: ProjectType): Promise<RefChoiceDTO[]> { return this.producers }
    public async ConsumerIdOf(): Promise<string | undefined> { return 'proj-id' }
    public Invalidate(id: string): void { this.invalidated.push(id) }
}

class FakeCatalog implements IPublishedBaseCatalog
{
    constructor(private readonly refs: RefChoiceDTO[]) {}
    public async ListMetaModels(): Promise<RefChoiceDTO[]> { return this.refs }
    public async ListLibraries(): Promise<RefChoiceDTO[]> { return [] }
}

class RecordingEvents implements IProjectEvents
{
    public events: ProjectEvent[] = []
    public async Raise(e: ProjectEvent): Promise<void> { this.events.push(e) }
}

class Fixture
{
    public readonly storage = new FakeStorage()
    public readonly resolver: FakeResolver
    public readonly events = new RecordingEvents()
    public readonly editor: ReferenceEditor

    constructor(producers: RefChoiceDTO[] = [], published: RefChoiceDTO[] = [])
    {
        this.storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({
            type: 'library', name: 'p', version: 1, extra: 'keep', metaModels: [{ id: 'mm', version: '1.0.0' }],
        }))
        this.resolver = new FakeResolver(producers)
        this.editor = new ReferenceEditor(new SolutionMember({ path: 'm', type: 'library' }), this.resolver as never, this.storage, new FakeCatalog(published), this.events)
    }
}

test('ReadManifest returns plain DTOs', async () =>
{
    const f = new Fixture()
    const m = await f.editor.ReadManifest()
    assert.deepEqual(m.metaModels, [{ id: 'mm', version: '1.0.0' }])
    assert.deepEqual(m.libraries, [])
})

test('WriteReferences persists, preserves fields, invalidates and raises ReferencesChanged', async () =>
{
    const f = new Fixture()
    await f.editor.WriteReferences({ libraries: [{ id: 'lib', version: '2.0.0' }] })
    const raw = JSON.parse(await f.storage.ReadText(PROJECT_MANIFEST_FILENAME))
    assert.deepEqual(raw.libraries, [{ id: 'lib', version: '2.0.0' }])
    assert.deepEqual(raw.metaModels, [{ id: 'mm', version: '1.0.0' }])
    assert.equal(raw.extra, 'keep')
    assert.deepEqual(f.resolver.invalidated, ['proj-id'])
    assert.equal(f.events.events.length, 1)
    assert.equal(f.events.events[0]?.Kind, ProjectEventKind.ReferencesChanged)
})

test('Classify distinguishes live, published and unresolved', async () =>
{
    const f = new Fixture([{ id: 'live', version: '1.0.0' }], [{ id: 'pub', version: '1.0.0' }])
    assert.equal(await f.editor.Classify(ProjectType.MetaModel, { id: 'live', version: '9.9.9' }), ReferenceResolutionKind.LiveWorkspace)
    assert.equal(await f.editor.Classify(ProjectType.MetaModel, { id: 'pub', version: '1.0.0' }), ReferenceResolutionKind.Published)
    assert.equal(await f.editor.Classify(ProjectType.MetaModel, { id: 'pub', version: '2.0.0' }), ReferenceResolutionKind.Unresolved)
})

test('AvailableReferencesFor excludes declared ids and dedupes', async () =>
{
    const f = new Fixture([{ id: 'a', version: '1.0.0' }], [{ id: 'a', version: '1.0.0' }, { id: 'mm', version: '2.0.0' }, { id: 'b', version: '1.0.0' }])
    const out = await f.editor.AvailableReferencesFor(ProjectType.MetaModel)
    assert.deepEqual(out, [{ id: 'a', version: '1.0.0' }, { id: 'b', version: '1.0.0' }])
})

test('AvailableVersionsFor sorts descending, release before prerelease', async () =>
{
    const f = new Fixture([{ id: 'x', version: '1.10.0' }], [{ id: 'x', version: '1.2.0' }, { id: 'x', version: '2.0.0-rc.1' }, { id: 'x', version: '2.0.0' }])
    assert.deepEqual(await f.editor.AvailableVersionsFor(ProjectType.MetaModel, 'x'), ['2.0.0', '2.0.0-rc.1', '1.10.0', '1.2.0'])
})
