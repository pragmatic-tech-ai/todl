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
