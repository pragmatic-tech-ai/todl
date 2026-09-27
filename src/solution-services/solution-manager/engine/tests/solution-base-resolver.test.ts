import test from 'node:test'
import assert from 'node:assert/strict'
import { ServiceProvider, FakeStorage, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionBaseResolver } from '../solution-base-resolver.js'
import { SolutionManagerService } from '../solution-manager-service.js'
import { PackageStoreKey } from '../../../todl-build-system/package-store.js'
import type { IPackageSource, SourcedPackage } from '../../../todl-build-system/package-source.js'
import type { PackageRef } from '../../../../publish/publish.js'
import { ProjectType, type ProjectManifest } from '../../../package-manager/manifest.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../project-services/core/project-factory.js'
import { WikiOriginKind } from '../../../project-services/core/wiki-origin.js'
import type { JsonNode } from '../../../../compiler-services/emit/json.js'

// Fixtures (static helpers on a test class — no free functions).
class Fixtures
{
    private static readonly ModelFileName = 'model.todl'
    private static readonly MetaModelNamespace = 'acme'

    // A minimal, defined SourcedPackage — stands in for "some published package",
    // where the test only cares that it is (or isn't) the value TryGet returns.
    static SomeSourced(): SourcedPackage
    {
        return { Document: { nodes: [], edges: [] }, Dependencies: [] }
    }

    // A ServiceProvider wired with a fake SolutionManagerService + inner published
    // source — the two seams SolutionBaseResolver reads from the container.
    static Provider(manager: Pick<SolutionManagerService, 'ActiveSolution'>, published: IPackageSource): ServiceProvider
    {
        const provider = new ServiceProvider()
        provider.registerInstance(PackageStoreKey, published as never)
        provider.registerInstance(SolutionManagerService.Key, manager as SolutionManagerService)
        return provider
    }

    // A fake IStorage backed by a Map<path,string> (the engine's own FakeStorage —
    // ReadText/WriteText/List over an in-memory map; see e.g. build-lifecycle.test.ts
    // and project-model-provider.test.ts for the same pattern).
    static Storage(files: Record<string, string>): IStorage
    {
        const storage = new FakeStorage()
        for (const [path, content] of Object.entries(files)) storage.WriteText(path, content)
        return storage
    }

    // A fake SolutionManagerService exposing ActiveSolution.Members with
    // { Storage } per member — the only surface SolutionBaseResolver reads
    // (it parses each member's own project.plexus off Storage; it never reads Ref).
    static Manager(members: { id: string; type: string; storage: IStorage | undefined }[]): Pick<SolutionManagerService, 'ActiveSolution'>
    {
        return {
            ActiveSolution: {
                Members: members.map((m) => ({ Ref: { path: m.id, type: m.type }, Storage: m.storage })),
            },
        } as unknown as Pick<SolutionManagerService, 'ActiveSolution'>
    }

    // A fake inner published IPackageSource: Map<'id@version', SourcedPackage>.
    static Published(map: Record<string, SourcedPackage>): IPackageSource
    {
        return {
            TryGet(ref: PackageRef): Promise<SourcedPackage | undefined>
            {
                return Promise.resolve(map[`${ref.id}@${ref.version}`])
            },
        }
    }

    // A meta-model member's files: project.plexus (id, type: meta-model, packageVersion)
    // + one .todl declaring `concept` in a shared namespace, so ProjectModelProvider.Compile
    // succeeds (mirrors ProjectModelProvider's own widgetProject() test fixture).
    static MetaModelFiles(id: string, version: string, concept: string): Record<string, string>
    {
        const manifest: ProjectManifest = { type: ProjectType.MetaModel, name: id, version: 1, id, packageVersion: version }
        return {
            [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest),
            [Fixtures.ModelFileName]: `namespace ${Fixtures.MetaModelNamespace} { concept ${concept} { label : string?; } }`,
        }
    }

    // A library member's files: project.plexus binding metaModels:[{id,version}] + one
    // .todl declaring a concept that extends the bound meta-model's concept by qualified
    // name — so a successful compile proves the base actually resolved.
    static LibraryFiles(id: string, metaModelId: string, metaModelVersion: string, term: string, baseConcept: string): Record<string, string>
    {
        const manifest: ProjectManifest = {
            type: ProjectType.Library, name: id, version: 1, id, packageVersion: '1.0.0',
            metaModels: [{ id: metaModelId, version: metaModelVersion }],
        }
        return {
            [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest),
            [Fixtures.ModelFileName]: `namespace lib_${id} { concept ${term} : ${Fixtures.MetaModelNamespace}.${baseConcept} { } }`,
        }
    }

    // A library member's files bound to ANOTHER LIBRARY (not a meta-model): project.plexus
    // declares a `libraries:` binding and the .todl extends the base library's own concept
    // by qualified name (namespace `lib_<baseLibraryId>`) — proves a two-hop live chain
    // (library -> library -> meta-model) resolves, and gives Invalidate('mm') a transitive
    // dependent one hop further out than a direct metaModels binding.
    static LibraryOnLibraryFiles(id: string, baseLibraryId: string, baseLibraryVersion: string, term: string, baseConcept: string): Record<string, string>
    {
        const manifest: ProjectManifest = {
            type: ProjectType.Library, name: id, version: 1, id, packageVersion: '1.0.0',
            libraries: [{ id: baseLibraryId, version: baseLibraryVersion }],
        }
        return {
            [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest),
            [Fixtures.ModelFileName]: `namespace lib_${id} { concept ${term} : lib_${baseLibraryId}.${baseConcept} { } }`,
        }
    }

    // A meta-model member's files whose .todl body is deliberately malformed, so
    // ProjectModelProvider.Compile/CompileWithBases returns `errors` and no `package`
    // — for asserting a failed live compile still falls back to the published copy.
    static BrokenMetaModelFiles(id: string, version: string): Record<string, string>
    {
        const manifest: ProjectManifest = { type: ProjectType.MetaModel, name: id, version: 1, id, packageVersion: version }
        return {
            [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest),
            [Fixtures.ModelFileName]: `namespace ${Fixtures.MetaModelNamespace} { concept ??? broken !!! }`,
        }
    }

    // A meta-model member whose OWN manifest binds another (published-only) meta-model
    // as its base, and whose .todl declares a concept with the SAME bare name as a node
    // in that base. This compiler's node ids are bare local names (namespace is a
    // separate attribute, not concatenated into `id` — confirmed against
    // Builder.defineConcept/makeNode), so the newly-declared concept collides with the
    // base node already seeded into the graph, and Builder.commit THROWS ("node ...
    // already exists") rather than returning a soft diagnostic — for asserting
    // ResolveBasesFor catches that throw and still falls back to the published copy
    // instead of crashing the whole resolve.
    static CollidingMetaModelFiles(id: string, version: string, baseId: string, baseVersion: string, concept: string): Record<string, string>
    {
        const manifest: ProjectManifest = {
            type: ProjectType.MetaModel, name: id, version: 1, id, packageVersion: version,
            metaModels: [{ id: baseId, version: baseVersion }],
        }
        return {
            [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest),
            [Fixtures.ModelFileName]: `namespace ${Fixtures.MetaModelNamespace} { concept ${concept} { } }`,
        }
    }

    // A published SourcedPackage built from real (if minimal) TodlDocument nodes —
    // for asserting which nodes/origins ResolveBasesFor surfaces from a published
    // fallback, as opposed to Fixtures.SomeSourced()'s empty stand-in document.
    static PublishedDoc(nodes: { id: string }[], dependencies?: { kind: string; id: string; version: string }[]): SourcedPackage
    {
        const jsonNodes: JsonNode[] = nodes.map((n) => ({
            id: n.id, tier: 'Domain', type: null, metaKind: null, namespace: null,
            localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: {},
        }))
        return {
            Document: { nodes: jsonNodes, edges: [] },
            Dependencies: (dependencies ?? []).map((d) => ({ kind: d.kind, id: d.id, version: d.version }) as PackageRef),
        }
    }

    // A consumer bound to two libraries (project.plexus `libraries: [{id:libA},{id:libB}]`)
    // plus a trivial, base-free concept so the project's own .todl compiles standalone —
    // for a live-diamond test where the consumer itself binds two open producers that
    // both, in turn, bind the same open producer further down.
    static TwoLibraryConsumer(id: string, libA: string, libB: string): Record<string, string>
    {
        const manifest: ProjectManifest = {
            type: ProjectType.Library, name: id, version: 1, id,
            libraries: [{ id: libA, version: '1.0.0' }, { id: libB, version: '1.0.0' }],
        }
        return {
            [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest),
            [Fixtures.ModelFileName]: `namespace lib_${id} { concept Consumer { } }`,
        }
    }
}

test('a live open producer member resolves as a base, preferred over a published package of the same id', async () =>
{
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'mm', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('mm', '1.0.0', 'Widget')) },
        ]),
        Fixtures.Published({ 'mm@1.0.0': Fixtures.SomeSourced() }), // stale published package of the same id
    )
    const resolver = new SolutionBaseResolver(provider)

    const got = await resolver.TryGet({ id: 'mm', version: '1.0.0' } as PackageRef)

    assert.ok(got !== undefined)
    // The live compile's document contains the live concept 'Widget', not the stale
    // published node (Fixtures.SomeSourced() has no nodes at all).
    assert.ok(got!.Document.nodes.some((n) => n.id === 'Widget'))
})

test('no matching member → delegates to the inner published source', async () =>
{
    const published = Fixtures.SomeSourced()
    const provider = Fixtures.Provider(Fixtures.Manager([]), Fixtures.Published({ 'lib@2.0.0': published }))
    const resolver = new SolutionBaseResolver(provider)

    assert.equal(await resolver.TryGet({ id: 'lib', version: '2.0.0' } as PackageRef), published)
})

test('a non-producer (architecture) member with a colliding id never shadows the published base', async () =>
{
    const published = Fixtures.SomeSourced()
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            // `id: 'arch'` deliberately collides with the requested ref — the type
            // guard (not an id mismatch) must be what excludes this member.
            { id: 'arch', type: 'architecture', storage: Fixtures.Storage({ [PROJECT_MANIFEST_FILENAME]: JSON.stringify({ type: 'architecture', name: 'arch', id: 'arch', version: 1 }) }) },
        ]),
        Fixtures.Published({ 'arch@1.0.0': published }),
    )
    const resolver = new SolutionBaseResolver(provider)

    assert.equal(await resolver.TryGet({ id: 'arch', version: '1.0.0' } as PackageRef), published)
})

test('an unresolved member (Storage undefined) is skipped, not compiled', async () =>
{
    const provider = Fixtures.Provider(
        Fixtures.Manager([{ id: 'mm', type: 'meta-model', storage: undefined }]),
        Fixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)

    assert.equal(await resolver.TryGet({ id: 'mm', version: '1.0.0' } as PackageRef), undefined) // no throw
})

test('a member bound to another open member resolves transitively', async () =>
{
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'mm', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('mm', '1.0.0', 'Widget')) },
            { id: 'lib', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '1.0.0', 'Gadget', 'Widget')) },
        ]),
        Fixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)

    // lib's own base binding on mm resolves through this SAME resolver instance
    // (TryGet('lib') -> compile lib -> resolve its metaModels binding -> TryGet('mm')),
    // so a successful, defined compile proves the transitive live resolution worked.
    const got = await resolver.TryGet({ id: 'lib', version: '1.0.0' } as PackageRef)

    assert.ok(got !== undefined)
})

test('an A→B→A member cycle terminates without overflow', async () =>
{
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'a', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryFiles('a', 'b', '1.0.0', 'A', 'B')) },
            { id: 'b', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryFiles('b', 'a', '1.0.0', 'B', 'A')) },
        ]),
        Fixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)

    // Must settle (defined or undefined) without infinite recursion / a RangeError —
    // the `resolving` DFS guard is what's under test, not the specific outcome.
    await assert.doesNotReject(resolver.TryGet({ id: 'a', version: '1.0.0' } as PackageRef))
})

test('a second TryGet for the same member returns the cached compile (no recompile)', async () =>
{
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'mm', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('mm', '1.0.0', 'Widget')) },
        ]),
        Fixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)

    const first = await resolver.TryGet({ id: 'mm', version: '1.0.0' } as PackageRef)
    const second = await resolver.TryGet({ id: 'mm', version: '1.0.0' } as PackageRef)

    // Identity equality proves the second TryGet returned the cached SourcedPackage
    // rather than recompiling the member.
    assert.ok(first !== undefined)
    assert.equal(second, first)
})

test('Invalidate drops only the member and its transitive dependents', async () =>
{
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'mm', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('mm', '1.0.0', 'Widget')) },
            { id: 'lib', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '1.0.0', 'Gadget', 'Widget')) },
            { id: 'archConsumer', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryOnLibraryFiles('archConsumer', 'lib', '1.0.0', 'Sprocket', 'Gadget')) },
            { id: 'other', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('other', '1.0.0', 'Unrelated')) },
        ]),
        Fixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)

    // Prime the cache by resolving all four.
    const mm = await resolver.TryGet({ id: 'mm', version: '1.0.0' } as PackageRef)
    const lib = await resolver.TryGet({ id: 'lib', version: '1.0.0' } as PackageRef)
    const archConsumer = await resolver.TryGet({ id: 'archConsumer', version: '1.0.0' } as PackageRef)
    const other = await resolver.TryGet({ id: 'other', version: '1.0.0' } as PackageRef)
    assert.ok(mm !== undefined && lib !== undefined && archConsumer !== undefined && other !== undefined)

    resolver.Invalidate('mm')

    // mm, lib, and archConsumer (which transitively binds mm through lib) are
    // evicted — re-resolving them yields a freshly-compiled (different) object.
    assert.notEqual(await resolver.TryGet({ id: 'mm', version: '1.0.0' } as PackageRef), mm)
    assert.notEqual(await resolver.TryGet({ id: 'lib', version: '1.0.0' } as PackageRef), lib)
    assert.notEqual(await resolver.TryGet({ id: 'archConsumer', version: '1.0.0' } as PackageRef), archConsumer)
    // The unrelated member's cached compile survives untouched.
    assert.equal(await resolver.TryGet({ id: 'other', version: '1.0.0' } as PackageRef), other)
})

test('Invalidate raises StaleMemberIds with exactly the evicted id set', async () =>
{
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'mm', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('mm', '1.0.0', 'Widget')) },
            { id: 'lib', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '1.0.0', 'Gadget', 'Widget')) },
            { id: 'other', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('other', '1.0.0', 'Unrelated')) },
        ]),
        Fixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)
    await resolver.TryGet({ id: 'mm', version: '1.0.0' } as PackageRef)
    await resolver.TryGet({ id: 'lib', version: '1.0.0' } as PackageRef)
    await resolver.TryGet({ id: 'other', version: '1.0.0' } as PackageRef)

    let raised: ReadonlySet<string> | undefined
    resolver.PropertyChanged('StaleMemberIds').subscribe((a) => { raised = a.newValue as ReadonlySet<string> })

    resolver.Invalidate('mm')

    assert.deepEqual(raised, new Set(['mm', 'lib']))
    assert.deepEqual(resolver.StaleMemberIds, new Set(['mm', 'lib']))
})

test('ResolveBasesFor prefers an open producer and tags its nodes with an OpenProject origin', async () =>
{
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '1.0.0', 'Gadget', 'Widget'))
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'mm', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('mm', '1.0.0', 'Widget')) },
        ]),
        Fixtures.Published({ 'mm@1.0.0': Fixtures.PublishedDoc([{ id: 'StaleWidget' }]) }),
    )
    const resolver = new SolutionBaseResolver(provider)
    const { bases, problems, originOf } = await resolver.ResolveBasesFor(consumer)
    assert.ok(bases.some((b) => b.nodes.some((n) => n.id === 'Widget')))   // live, not StaleWidget
    assert.equal(originOf.get('Widget')!.kind, WikiOriginKind.OpenProject)
    assert.deepEqual(problems, [])
})

test('ResolveBasesFor falls back to published and tags Package origin, recursing deps', async () =>
{
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '1.0.0', 'Gadget', 'Widget'))
    const provider = Fixtures.Provider(
        Fixtures.Manager([]),   // no open producer
        Fixtures.Published({ 'mm@1.0.0': Fixtures.PublishedDoc([{ id: 'Widget' }], [{ kind: 'meta-model', id: 'core', version: '2.0.0' }]),
                             'core@2.0.0': Fixtures.PublishedDoc([{ id: 'Base' }]) }),
    )
    const resolver = new SolutionBaseResolver(provider)
    const { bases, originOf } = await resolver.ResolveBasesFor(consumer)
    assert.ok(bases.some((b) => b.nodes.some((n) => n.id === 'Widget')))
    assert.ok(bases.some((b) => b.nodes.some((n) => n.id === 'Base')))     // transitive dep
    assert.equal(originOf.get('Widget')!.kind, WikiOriginKind.Package)
})

test('ResolveBasesFor emits a not-published problem for an absent base', async () =>
{
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('lib', 'ghost', '9.9.9', 'G', 'X'))
    const provider = Fixtures.Provider(Fixtures.Manager([]), Fixtures.Published({}))
    const resolver = new SolutionBaseResolver(provider)
    const { problems } = await resolver.ResolveBasesFor(consumer)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /ghost@9\.9\.9.*not published/)
})

test('ResolveBasesFor reports a version mismatch against an open producer', async () =>
{
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '2.0.0', 'Gadget', 'Widget')) // wants @2.0.0
    const provider = Fixtures.Provider(
        Fixtures.Manager([{ id: 'mm', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('mm', '1.0.0', 'Widget')) }]), // is @1.0.0
        Fixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)
    const { problems } = await resolver.ResolveBasesFor(consumer)
    assert.ok(problems.some((p) => /binding requests @2\.0\.0, project is @1\.0\.0/.test(p)))
})

test('ResolveBasesFor: a self-binding producer yields one cyclic problem and falls back to published', async () =>
{
    // consumer binds 'a'; 'a' is an open library that binds itself. 'a' declares a
    // concept named "SelfA" (distinct from the "A" it extends) so its own live
    // compile doesn't collide, id-wise, with the "A" base node its self-reference
    // falls back to publishing — an incidental clash this compiler's flat (bare,
    // non-namespace-qualified) node-id scheme would otherwise produce, unrelated
    // to the cyclic-detection behavior under test.
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('c', 'a', '1.0.0', 'C', 'A'))
    const provider = Fixtures.Provider(
        Fixtures.Manager([{ id: 'a', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryFiles('a', 'a', '1.0.0', 'SelfA', 'A')) }]),
        Fixtures.Published({ 'a@1.0.0': Fixtures.PublishedDoc([{ id: 'A' }]) }),
    )
    const resolver = new SolutionBaseResolver(provider)
    const { problems } = await resolver.ResolveBasesFor(consumer)
    assert.equal(problems.filter((p) => /cyclic local reference to "a"/.test(p)).length, 1)
})

test('ResolveBasesFor surfaces live compile errors but still falls back to the published base', async () =>
{
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '1.0.0', 'Gadget', 'Widget'))
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'mm', type: 'meta-model', storage: Fixtures.Storage(Fixtures.BrokenMetaModelFiles('mm', '1.0.0')) },
        ]),
        Fixtures.Published({ 'mm@1.0.0': Fixtures.PublishedDoc([{ id: 'Widget' }]) }),
    )
    const resolver = new SolutionBaseResolver(provider)
    const { bases, problems } = await resolver.ResolveBasesFor(consumer)
    assert.ok(problems.length > 0)
    assert.ok(bases.some((b) => b.nodes.some((n) => n.id === 'Widget')))
})

test('ResolveBasesFor catches a live compile that throws and still falls back to the published base', async () =>
{
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '1.0.0', 'Gadget', 'Widget'))
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            // 'mm' binds published-only 'core' as its own base, and declares an OWN
            // concept "Widget" — the same bare name as 'core's node — so mm's live
            // compile throws when checked against the resolved base closure.
            { id: 'mm', type: 'meta-model', storage: Fixtures.Storage(Fixtures.CollidingMetaModelFiles('mm', '1.0.0', 'core', '1.0.0', 'Widget')) },
        ]),
        Fixtures.Published({
            'core@1.0.0': Fixtures.PublishedDoc([{ id: 'Widget' }]),
            'mm@1.0.0': Fixtures.PublishedDoc([{ id: 'Widget' }]),
        }),
    )
    const resolver = new SolutionBaseResolver(provider)
    const result = resolver.ResolveBasesFor(consumer)
    await assert.doesNotReject(result)
    const { bases, problems } = await result
    assert.ok(problems.length > 0)
    assert.ok(bases.some((b) => b.nodes.some((n) => n.id === 'Widget')))
})

test('ReferencedPublishedRefs returns the transitive published id@version closure', async () => {
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '1.0.0', 'G', 'W'))
    const provider = Fixtures.Provider(Fixtures.Manager([]), Fixtures.Published({
        'mm@1.0.0': Fixtures.PublishedDoc([{ id: 'W' }], [{ kind: 'meta-model', id: 'core', version: '2.0.0' }]),
        'core@2.0.0': Fixtures.PublishedDoc([{ id: 'B' }]),
    }))
    const resolver = new SolutionBaseResolver(provider)
    const refs = await resolver.ReferencedPublishedRefs(consumer)
    assert.deepEqual([...refs].sort(), ['core@2.0.0', 'mm@1.0.0'])
})

test('ReferencedPublishedRefs records an absent ref own key then stops', async () => {
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('lib', 'ghost', '9.9.9', 'G', 'X'))
    const provider = Fixtures.Provider(Fixtures.Manager([]), Fixtures.Published({}))
    const resolver = new SolutionBaseResolver(provider)
    const refs = await resolver.ReferencedPublishedRefs(consumer)
    assert.deepEqual([...refs], ['ghost@9.9.9'])
})

test('WorkspaceProducers lists open producers of a kind, skipping versionless ones', async () => {
    const versionlessManifest = { type: 'meta-model', name: 'mmNoVersion', version: 1, id: 'mmNoVersion' } // packageVersion absent
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'mm', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('mm', '1.0.0', 'W')) },
            { id: 'lib', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryFiles('lib', 'mm', '1.0.0', 'G', 'W')) },
            { id: 'mmNoVersion', type: 'meta-model', storage: Fixtures.Storage({ [PROJECT_MANIFEST_FILENAME]: JSON.stringify(versionlessManifest) }) },
        ]),
        Fixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)
    const mm = await resolver.WorkspaceProducers(ProjectType.MetaModel)
    // The versionless member is skipped — only 'mm' (which has a packageVersion) is listed.
    assert.deepEqual(mm, [{ id: 'mm', version: '1.0.0' }])
})

test('ProducedIdOf returns a producer id and undefined for a non-producer', async () => {
    const provider = Fixtures.Provider(Fixtures.Manager([]), Fixtures.Published({}))
    const resolver = new SolutionBaseResolver(provider)
    const mmStorage = Fixtures.Storage(Fixtures.MetaModelFiles('mm', '1.0.0', 'W'))
    const archStorage = Fixtures.Storage({ [PROJECT_MANIFEST_FILENAME]: JSON.stringify({ type: 'architecture', name: 'a', id: 'a', version: 1 }) })
    assert.equal(await resolver.ProducedIdOf(mmStorage), 'mm')
    assert.equal(await resolver.ProducedIdOf(archStorage), undefined)
})

test('ResolveBasesFor surfaces an open producer\'s transitive live bases (two-level live chain)', async () =>
{
    // consumer → open library L → open meta-model M ; M's nodes must appear in the closure.
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('c', 'L', '1.0.0', 'C', 'Gadget'))
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'M', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('M', '1.0.0', 'Widget')) },
            { id: 'L', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryFiles('L', 'M', '1.0.0', 'Gadget', 'Widget')) },
        ]),
        Fixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)
    const { bases, originOf } = await resolver.ResolveBasesFor(consumer)
    assert.ok(bases.some((b) => b.nodes.some((n) => n.id === 'Gadget')))  // L (direct)
    assert.ok(bases.some((b) => b.nodes.some((n) => n.id === 'Widget')))  // M (transitive live)
    assert.equal(originOf.get('Widget')!.kind, WikiOriginKind.OpenProject)
})

test('ResolveBasesFor resolves a live diamond once (no duplicate, no cyclic problem)', async () =>
{
    // consumer binds A and B; both A and B (open libraries) bind the same open
    // meta-model D — a diamond. D must be compiled/pushed into the closure once.
    const consumer = Fixtures.Storage(Fixtures.TwoLibraryConsumer('c', 'A', 'B'))
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'D', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('D', '1.0.0', 'Dnode')) },
            { id: 'A', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryFiles('A', 'D', '1.0.0', 'Anode', 'Dnode')) },
            { id: 'B', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryFiles('B', 'D', '1.0.0', 'Bnode', 'Dnode')) },
        ]),
        Fixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)
    const { bases, problems } = await resolver.ResolveBasesFor(consumer)
    assert.equal(problems.filter((p) => /cyclic/.test(p)).length, 0)
    assert.equal(bases.filter((b) => b.nodes.some((n) => n.id === 'Dnode')).length, 1)  // deduped
})
