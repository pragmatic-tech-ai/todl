import test from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ReferenceEditor, ReferenceResolutionKind, type IPublishedBaseCatalog, type RefChoiceDTO } from '../reference-editor.js'
import { PROJECT_MANIFEST_FILENAME } from '../../core/project-factory.js'
import { ProjectType } from '../../../package-manager/manifest.js'
import { ProjectEventKind, type IProjectEvents, type ProjectEvent } from '../../generators/project-events.js'

class CallLog
{
    public readonly entries: string[] = []
}

class LoggingStorage extends FakeStorage
{
    public lastText: string | undefined
    constructor(private readonly log: CallLog) { super() }
    public Seed(path: string, text: string): Promise<void>
    {
        return super.WriteText(path, text)
    }

    public override async WriteText(path: string, text: string): Promise<void>
    {
        await super.WriteText(path, text)
        this.lastText = text
        this.log.entries.push('write')
    }
}

class FakeResolver
{
    public invalidated: string[] = []
    public manifestAtInvalidate: string | undefined
    constructor(private readonly producers: RefChoiceDTO[], private readonly log: CallLog, private readonly storage: LoggingStorage) {}
    public async WorkspaceProducers(_k: ProjectType): Promise<RefChoiceDTO[]> { return this.producers }
    public async ConsumerIdOf(): Promise<string | undefined> { return 'proj-id' }
    public Invalidate(id: string): void
    {
        this.log.entries.push('invalidate')
        this.manifestAtInvalidate = this.storage.lastText
        this.invalidated.push(id)
    }
}

class FakeCatalog implements IPublishedBaseCatalog
{
    constructor(private readonly refs: RefChoiceDTO[], private readonly libs: RefChoiceDTO[] = []) {}
    public async ListMetaModels(): Promise<RefChoiceDTO[]> { return this.refs }
    public async ListLibraries(): Promise<RefChoiceDTO[]> { return this.libs }
}

class RecordingEvents implements IProjectEvents
{
    public events: ProjectEvent[] = []
    constructor(private readonly log: CallLog) {}
    public async Raise(e: ProjectEvent): Promise<void>
    {
        this.log.entries.push('raise')
        this.events.push(e)
    }
}

class Fixture
{
    public readonly log = new CallLog()
    public readonly storage = new LoggingStorage(this.log)
    public readonly resolver: FakeResolver
    public readonly events = new RecordingEvents(this.log)
    public readonly editor: ReferenceEditor

    constructor(producers: RefChoiceDTO[] = [], published: RefChoiceDTO[] = [], libraryPublished: RefChoiceDTO[] = [])
    {
        this.storage.Seed(PROJECT_MANIFEST_FILENAME, JSON.stringify({
            type: 'library', name: 'p', version: 1, extra: 'keep', metaModels: [{ id: 'mm', version: '1.0.0' }], libraries: [{ id: 'lb', version: '1.0.0' }],
        }))
        this.resolver = new FakeResolver(producers, this.log, this.storage)
        this.editor = new ReferenceEditor(this.resolver as never, this.storage, new FakeCatalog(published, libraryPublished), this.events)
    }
}

test('ReadManifest returns plain DTOs', async () =>
{
    const f = new Fixture()
    const m = await f.editor.ReadManifest()
    assert.deepEqual(m.metaModels, [{ id: 'mm', version: '1.0.0' }])
    assert.deepEqual(m.libraries, [{ id: 'lb', version: '1.0.0' }])
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
    assert.deepEqual(f.log.entries, ['write', 'invalidate', 'raise'])
    assert.equal(JSON.parse(f.resolver.manifestAtInvalidate ?? '{}').libraries[0].id, 'lib')
})

test('WriteReferences with metaModels only leaves libraries untouched', async () =>
{
    const f = new Fixture()
    await f.editor.WriteReferences({ metaModels: [{ id: 'mm2', version: '3.0.0' }] })
    const raw = JSON.parse(await f.storage.ReadText(PROJECT_MANIFEST_FILENAME))
    assert.deepEqual(raw.metaModels, [{ id: 'mm2', version: '3.0.0' }])
    assert.deepEqual(raw.libraries, [{ id: 'lb', version: '1.0.0' }])
})

test('Classify and AvailableReferencesFor use the library catalog for ProjectType.Library', async () =>
{
    const f = new Fixture([], [{ id: 'mmonly', version: '1.0.0' }], [{ id: 'lp', version: '1.0.0' }, { id: 'lb', version: '2.0.0' }])
    assert.equal(await f.editor.Classify(ProjectType.Library, { id: 'lp', version: '1.0.0' }), ReferenceResolutionKind.Published)
    assert.equal(await f.editor.Classify(ProjectType.Library, { id: 'mmonly', version: '1.0.0' }), ReferenceResolutionKind.Unresolved)
    assert.deepEqual(await f.editor.AvailableReferencesFor(ProjectType.Library), [{ id: 'lp', version: '1.0.0' }])
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
