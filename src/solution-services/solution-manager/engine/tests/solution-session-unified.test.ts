import test from 'node:test'
import assert from 'node:assert/strict'
import { ServiceProvider, FakeStorage, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionBaseResolver } from '../solution-base-resolver.js'
import { SolutionManagerService } from '../solution-manager-service.js'
import { PackageStoreKey } from '../../../todl-build-system/package-store.js'
import type { IPackageSource, SourcedPackage } from '../../../todl-build-system/package-source.js'
import { compilePackage, PackageKind, type PackageRef } from '../../../../publish/publish.js'
import { DiagnosticCode, type Diagnostic } from '../../../../compiler-services/diagnostics/diagnostic.js'
import { ProjectType, type ProjectManifest } from '../../../package-manager/manifest.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../project-services/core/project-factory.js'

// Fixtures for composing a solution through the single live-first resolver. Static
// helpers on a class — no free functions.
class UnifiedFixtures
{
    public static readonly ModelFileName = 'model.todl'
    public static readonly LibraryId = 'microsoft'
    public static readonly ConsumerId = 'landscape'
    public static readonly Version = '1.0.0'
    public static readonly SolutionRoot = '/work/sol'
    private static readonly LocalPath = './member'
    private static readonly NoComposeMessage = 'no published compose in test'

    // A published-only fake registry: id@version -> SourcedPackage.
    public static Published(map: Map<string, SourcedPackage>): IPackageSource
    {
        return {
            TryGet(ref: PackageRef): Promise<SourcedPackage | undefined>
            {
                return Promise.resolve(map.get(`${ref.id}@${ref.version}`))
            },
        }
    }

    public static Storage(manifest: ProjectManifest, model: string): IStorage
    {
        const storage = new FakeStorage()
        storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest))
        storage.WriteText(UnifiedFixtures.ModelFileName, model)
        return storage
    }

    public static LibraryStorage(): IStorage
    {
        // Unpublished: no packageVersion.
        return UnifiedFixtures.Storage(
            { type: ProjectType.Library, name: UnifiedFixtures.LibraryId, version: 1, id: UnifiedFixtures.LibraryId },
            `namespace ms { concept Tenant { label : string?; } }`,
        )
    }

    public static ConsumerStorage(): IStorage
    {
        return UnifiedFixtures.Storage(
            {
                type: ProjectType.Library, name: UnifiedFixtures.ConsumerId, version: 1, id: UnifiedFixtures.ConsumerId,
                libraries: [{ id: UnifiedFixtures.LibraryId, version: UnifiedFixtures.Version }],
            },
            `namespace ms { model M : ms { Tenant t { label = "T"; } } }`,
        )
    }

    // A real manager + resolver on one provider. `members` are opened with their
    // storage so the resolver sees them as live; `published` backs the fallback.
    public static async Manager(members: { id: string; storage: IStorage }[], published: IPackageSource): Promise<SolutionManagerService>
    {
        const provider = new ServiceProvider()
        provider.registerInstance(SolutionManagerService.StorageRegistryKey, { CreateStorage: () => new FakeStorage() } as never)
        provider.registerInstance(SolutionManagerService.ProjectFactoryRegistryKey, {} as never)
        provider.registerInstance(SolutionManagerService.PromptServiceKey, {} as never)
        provider.registerInstance(SolutionManagerService.PackageSourceKey, {
            resolve: () => Promise.reject(new Error(UnifiedFixtures.NoComposeMessage)),
        })
        provider.registerInstance(PackageStoreKey, published as never)
        const manager = new SolutionManagerService(provider)
        provider.registerInstance(SolutionManagerService.Key, manager)
        provider.registerInstance(SolutionBaseResolver.Key, new SolutionBaseResolver(provider))
        await manager.NewSolution(UnifiedFixtures.SolutionRoot)
        for (const m of members)
        {
            const member = manager.ActiveSolution!.AddMember(`${UnifiedFixtures.LocalPath}/${m.id}`, ProjectType.Library)
            member.Storage = m.storage
        }
        return manager
    }

    public static Unresolved(diags: readonly Diagnostic[], needle: string): Diagnostic[]
    {
        return diags.filter((d) => d.code === DiagnosticCode.PackageUnresolved && d.message.includes(needle))
    }
}

test('Compose resolves an unpublished member\'s concepts (no PackageUnresolved for in-solution symbols)', async () =>
{
    const manager = await UnifiedFixtures.Manager(
        [
            { id: UnifiedFixtures.LibraryId, storage: UnifiedFixtures.LibraryStorage() },
            { id: UnifiedFixtures.ConsumerId, storage: UnifiedFixtures.ConsumerStorage() },
        ],
        UnifiedFixtures.Published(new Map()),
    )

    const diags = await manager.Compose([{ model: UnifiedFixtures.ConsumerId, version: UnifiedFixtures.Version }])

    assert.equal(UnifiedFixtures.Unresolved(diags, UnifiedFixtures.LibraryId).length, 0, diags.map((d) => d.message).join('; '))
    assert.deepEqual(diags, [])
})

test('published-only composition still works through the resolver', async () =>
{
    const compiled = compilePackage(
        [],
        [{ uri: UnifiedFixtures.ModelFileName, text: `namespace acme { concept Widget { name : string; } }` }],
        { id: 'acme.pub', version: UnifiedFixtures.Version },
    )
    assert.ok(compiled.ok && compiled.package)
    const published = UnifiedFixtures.Published(new Map([
        [`acme.pub@${UnifiedFixtures.Version}`, { Document: compiled.package!.document, Dependencies: compiled.package!.document.dependencies ?? [] }],
    ]))
    const manager = await UnifiedFixtures.Manager([], published)

    const diags = await manager.Compose([{ model: 'acme.pub', version: UnifiedFixtures.Version }])

    assert.deepEqual(diags, [])
})

test('an unknown member still yields one PackageUnresolved diagnostic through the resolver', async () =>
{
    const manager = await UnifiedFixtures.Manager([], UnifiedFixtures.Published(new Map()))

    const diags = await manager.Compose([{ model: 'acme.missing', version: UnifiedFixtures.Version }])

    assert.equal(UnifiedFixtures.Unresolved(diags, 'acme.missing').length, 1)
})
