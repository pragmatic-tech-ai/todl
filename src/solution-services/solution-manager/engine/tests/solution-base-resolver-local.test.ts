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
import type { JsonNode } from '../../../../compiler-services/emit/json.js'

// Fixtures for the version-free (CompileLocal) live-member branch. Static helpers
// on a class — no free functions.
class LocalFixtures
{
    private static readonly ModelFileName = 'model.todl'
    private static readonly Namespace = 'ms'
    private static readonly NoPublishableVersionPattern = /no publishable version|not published/

    static get NoVersionProblem(): RegExp
    {
        return LocalFixtures.NoPublishableVersionPattern
    }

    static Provider(members: { id: string; type: string; storage: IStorage | undefined }[], published: IPackageSource): ServiceProvider
    {
        const manager = {
            ActiveSolution: { Members: members.map((m) => ({ Ref: { path: m.id, type: m.type }, Storage: m.storage })) },
        }
        const provider = new ServiceProvider()
        provider.registerInstance(PackageStoreKey, published as never)
        provider.registerInstance(SolutionManagerService.Key, manager as unknown as SolutionManagerService)
        return provider
    }

    static Storage(files: Record<string, string>): IStorage
    {
        const storage = new FakeStorage()
        for (const [path, content] of Object.entries(files)) storage.WriteText(path, content)
        return storage
    }

    static Published(map: Record<string, SourcedPackage>): IPackageSource
    {
        return {
            TryGet(ref: PackageRef): Promise<SourcedPackage | undefined>
            {
                return Promise.resolve(map[`${ref.id}@${ref.version}`])
            },
        }
    }

    // A producer member exporting one concept. packageVersion is OMITTED when undefined
    // (exactOptionalPropertyTypes) — the unpublished, in-solution case.
    static ProducerFiles(type: ProjectType, id: string, concept: string, packageVersion: string | undefined): Record<string, string>
    {
        const manifest: ProjectManifest = packageVersion === undefined
            ? { type, name: id, version: 1, id }
            : { type, name: id, version: 1, id, packageVersion }
        return {
            [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest),
            [LocalFixtures.ModelFileName]: `namespace ${LocalFixtures.Namespace} { concept ${concept} { label : string?; } }`,
        }
    }

    // A consumer (the "landscape") whose manifest binds one library.
    static ConsumerFiles(id: string, libraryId: string, libraryVersion: string): Record<string, string>
    {
        const manifest: ProjectManifest = {
            type: ProjectType.Library, name: id, version: 1, id,
            libraries: [{ id: libraryId, version: libraryVersion }],
        }
        return {
            [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest),
            [LocalFixtures.ModelFileName]: `namespace lib_${id} { concept Consumer { } }`,
        }
    }

    // An unpublished library that binds another library (for the A<->B cycle).
    static CyclicFiles(id: string, otherId: string, concept: string): Record<string, string>
    {
        const manifest: ProjectManifest = {
            type: ProjectType.Library, name: id, version: 1, id,
            libraries: [{ id: otherId, version: '1.0.0' }],
        }
        return {
            [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest),
            [LocalFixtures.ModelFileName]: `namespace lib_${id} { concept ${concept} { } }`,
        }
    }

    static PublishedDoc(nodeIds: string[]): SourcedPackage
    {
        const nodes: JsonNode[] = nodeIds.map((id) => ({
            id, tier: 'Domain', type: null, metaKind: null, namespace: null,
            localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: {},
        }))
        return { Document: { nodes, edges: [] }, Dependencies: [] }
    }
}

test('an unpublished in-solution member contributes its symbols to a consumer', async () =>
{
    const consumer = LocalFixtures.Storage(LocalFixtures.ConsumerFiles('landscape', 'microsoft', '1.0.0'))
    const provider = LocalFixtures.Provider(
        [{ id: 'microsoft', type: 'library', storage: LocalFixtures.Storage(LocalFixtures.ProducerFiles(ProjectType.Library, 'microsoft', 'tenant', undefined)) }],
        LocalFixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)

    const { bases, problems } = await resolver.ResolveBasesFor(consumer)

    assert.ok(bases.some((d) => d.nodes.some((n) => n.id === 'tenant')), 'microsoft symbols resolved')
    assert.equal(problems.filter((p) => LocalFixtures.NoVersionProblem.test(p)).length, 0, problems.join('; '))
})

test('published fallback still works when no live producer exists', async () =>
{
    const consumer = LocalFixtures.Storage(LocalFixtures.ConsumerFiles('landscape', 'microsoft', '1.0.0'))
    const provider = LocalFixtures.Provider([], LocalFixtures.Published({ 'microsoft@1.0.0': LocalFixtures.PublishedDoc(['tenant']) }))
    const resolver = new SolutionBaseResolver(provider)

    const { bases, problems } = await resolver.ResolveBasesFor(consumer)

    assert.ok(bases.some((d) => d.nodes.some((n) => n.id === 'tenant')))
    assert.deepEqual(problems, [])
})

test('versionMismatch still warns when the live producer declares a real packageVersion', async () =>
{
    const consumer = LocalFixtures.Storage(LocalFixtures.ConsumerFiles('landscape', 'microsoft', '1.0.0'))
    const provider = LocalFixtures.Provider(
        [{ id: 'microsoft', type: 'library', storage: LocalFixtures.Storage(LocalFixtures.ProducerFiles(ProjectType.Library, 'microsoft', 'tenant', '2.0.0')) }],
        LocalFixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)

    const { bases, problems } = await resolver.ResolveBasesFor(consumer)

    assert.ok(problems.some((p) => /binding requests @1\.0\.0, project is @2\.0\.0/.test(p)), problems.join('; '))
    assert.ok(bases.some((d) => d.nodes.some((n) => n.id === 'tenant')))
})

test('cyclic in-solution references do not hang and fall through with a cyclic problem', async () =>
{
    const consumer = LocalFixtures.Storage(LocalFixtures.ConsumerFiles('c', 'a', '1.0.0'))
    const provider = LocalFixtures.Provider(
        [
            { id: 'a', type: 'library', storage: LocalFixtures.Storage(LocalFixtures.CyclicFiles('a', 'b', 'Anode')) },
            { id: 'b', type: 'library', storage: LocalFixtures.Storage(LocalFixtures.CyclicFiles('b', 'a', 'Bnode')) },
        ],
        LocalFixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)

    const { problems } = await resolver.ResolveBasesFor(consumer)

    assert.ok(problems.some((p) => /cyclic local reference/.test(p)), problems.join('; '))
})
