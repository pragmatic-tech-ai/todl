import test from 'node:test'
import assert from 'node:assert/strict'
import { ServiceProvider, FakeStorage, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { MemberProjectOps } from '../member-project-ops.js'
import { SemVer, VersionPart } from '../semver.js'
import { PROJECT_MANIFEST_FILENAME, type ProjectFileFormat } from '../project-factory.js'
import { ProjectType, type ProjectManifest } from '../../../package-manager/manifest.js'
import { FakeProjectFactory } from '../../../solution-manager/engine/tests/fake-project-factory.js'
import { SolutionBaseResolver } from '../../../solution-manager/engine/solution-base-resolver.js'
import { SolutionManagerService } from '../../../solution-manager/engine/solution-manager-service.js'
import { PackageStoreKey } from '../../../todl-build-system/package-store.js'
import { SolutionMember } from '../../../solution-manager/engine/solution-member.js'
import { type IProjectFactoryRegistry } from '../../../solution-manager/engine/host-services.js'

class VersionedFactory extends FakeProjectFactory
{
    public override readonly formats: readonly ProjectFileFormat[] = [{ extension: '.todl', kind: 'todl', displayName: 'TODL' }]
    public readonly requiresMetaModel = true
    public version = '1.2.3'
    public scaffoldCalls = 0
    public async getVersion(_s: IStorage): Promise<string> { return this.version }
    public async setVersion(_s: IStorage, v: string): Promise<void> { this.version = v }
    public async updateScaffold(_s: IStorage): Promise<readonly string[]> { this.scaffoldCalls++; return ['a.md', 'b.md'] }
}

class Fixtures
{
    static Registry(factory: FakeProjectFactory): IProjectFactoryRegistry
    {
        return { factoryFor: (t: string) => (t === factory.typeId ? factory : undefined), All: () => [factory] }
    }

    static Resolver(): SolutionBaseResolver
    {
        const provider = new ServiceProvider()
        provider.registerInstance(PackageStoreKey, { TryGet: async () => undefined } as never)
        provider.registerInstance(SolutionManagerService.Key, { ActiveSolution: { Members: [] } } as never)
        return new SolutionBaseResolver(provider)
    }

    static Member(type: string, files: Record<string, string> = {}): SolutionMember
    {
        const member = new SolutionMember({ path: 'm', type })
        const storage = new FakeStorage()
        for (const [p, c] of Object.entries(files)) storage.WriteText(p, c)
        member.Storage = storage
        return member
    }
}

test('SemVer.Bump zeroes lower parts and coerces junk', () =>
{
    assert.equal(SemVer.Bump('1.2.3', VersionPart.Patch), '1.2.4')
    assert.equal(SemVer.Bump('1.2.3', VersionPart.Minor), '1.3.0')
    assert.equal(SemVer.Bump('1.2.3', VersionPart.Major), '2.0.0')
    assert.equal(SemVer.Bump('5', VersionPart.Patch), '5.0.1')
    assert.equal(SemVer.Bump('', VersionPart.Major), '1.0.0')
    assert.equal(SemVer.IsValid('1.0.0'), true)
    assert.equal(SemVer.IsValid('../x'), false)
})

test('BumpVersion patch 1.2.3 -> 1.2.4 and persists; SetVersion writes', async () =>
{
    const f = new VersionedFactory()
    const ops = new MemberProjectOps(Fixtures.Registry(f), Fixtures.Resolver())
    const m = Fixtures.Member('fake')
    assert.equal(await ops.BumpVersion(m, VersionPart.Patch), '1.2.4')
    assert.equal(f.version, '1.2.4')
    await ops.SetVersion(m, '9.9.9')
    assert.equal(f.version, '9.9.9')
})

test('UpdateScaffold returns written files', async () =>
{
    const f = new VersionedFactory()
    const ops = new MemberProjectOps(Fixtures.Registry(f), Fixtures.Resolver())
    assert.deepEqual(await ops.UpdateScaffold(Fixtures.Member('fake')), ['a.md', 'b.md'])
    assert.equal(f.scaffoldCalls, 1)
})

test('capability queries reflect factory flags', () =>
{
    const rich = new MemberProjectOps(Fixtures.Registry(new VersionedFactory()), Fixtures.Resolver())
    const m = Fixtures.Member('fake')
    assert.equal(rich.IsVersioned(m), true)
    assert.equal(rich.CanRefreshBases(m), true)
    assert.equal(rich.SupportsScaffold(m), true)
    assert.equal(rich.FormatsFor(m).length, 1)

    const bare = new MemberProjectOps(Fixtures.Registry(new FakeProjectFactory()), Fixtures.Resolver())
    assert.equal(bare.IsVersioned(m), false)
    assert.equal(bare.CanRefreshBases(m), false)
    assert.equal(bare.SupportsScaffold(m), false)
    assert.deepEqual(bare.FormatsFor(m), [])

    const unknown = Fixtures.Member('nope')
    assert.equal(rich.IsVersioned(unknown), false)
    assert.deepEqual(rich.FormatsFor(unknown), [])
})

test('operations on unsupported members throw for the right reason', async () =>
{
    const ops = new MemberProjectOps(Fixtures.Registry(new FakeProjectFactory()), Fixtures.Resolver())
    const m = Fixtures.Member('fake')
    await assert.rejects(ops.BumpVersion(m, VersionPart.Patch), { message: MemberProjectOps.NoVersionError })
    await assert.rejects(ops.SetVersion(m, '1.0.0'), { message: MemberProjectOps.NoVersionError })
    await assert.rejects(ops.UpdateScaffold(m), { message: MemberProjectOps.NoScaffoldError })

    const orphan = Fixtures.Member('nope')
    orphan.Storage = undefined
    await assert.rejects(ops.BumpVersion(orphan, VersionPart.Patch), { message: MemberProjectOps.NoFactoryError })
    await assert.rejects(ops.UpdateScaffold(orphan), { message: MemberProjectOps.NoFactoryError })
})

test('member with a factory but no storage throws the storage error', async () =>
{
    const ops = new MemberProjectOps(Fixtures.Registry(new VersionedFactory()), Fixtures.Resolver())
    const m = Fixtures.Member('fake')
    m.Storage = undefined
    await assert.rejects(ops.BumpVersion(m, VersionPart.Patch), { message: MemberProjectOps.NoStorageError })
    await assert.rejects(ops.SetVersion(m, '1.0.0'), { message: MemberProjectOps.NoStorageError })
    await assert.rejects(ops.UpdateScaffold(m), { message: MemberProjectOps.NoStorageError })
})

test('RefreshBases invalidates by manifest id; no manifest id or storage is a no-op', async () =>
{
    const resolver = Fixtures.Resolver()
    const ops = new MemberProjectOps(Fixtures.Registry(new FakeProjectFactory()), resolver)
    const before = resolver.StaleMemberIds

    await ops.RefreshBases(Fixtures.Member('fake'))
    assert.equal(resolver.StaleMemberIds, before)
    const noStorage = Fixtures.Member('fake')
    noStorage.Storage = undefined
    await ops.RefreshBases(noStorage)
    assert.equal(resolver.StaleMemberIds, before)

    const manifest: ProjectManifest = { type: ProjectType.MetaModel, name: 'mm', version: 1, id: 'mm', packageVersion: '1.0.0' }
    await ops.RefreshBases(Fixtures.Member('fake', { [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest) }))
    assert.ok(resolver.StaleMemberIds.has('mm'))
})
