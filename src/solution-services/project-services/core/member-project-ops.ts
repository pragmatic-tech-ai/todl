import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    isVersioned,
    supportsScaffold,
    type IProjectFactory,
    type IVersionedProjectFactory,
    type ProjectFileFormat,
} from './project-factory.js'
import { SemVer, type VersionPart } from './semver.js'
import { type IProjectFactoryRegistry } from '../../solution-manager/engine/host-services.js'
import { type SolutionBaseResolver } from '../../solution-manager/engine/solution-base-resolver.js'
import { type SolutionMember } from '../../solution-manager/engine/solution-member.js'

// UX-free per-member project operations: version bump/set, agent-scaffold refresh,
// base-cache refresh, and the capability queries a host uses to gate its commands.
// Every operation resolves the member's IProjectFactory through the factory registry
// (by the member's declared project type) and acts on the member's rooted storage.
// Reports no status text - callers own presentation.
export class MemberProjectOps
{
    constructor(
        private readonly registry: IProjectFactoryRegistry,
        private readonly resolver: SolutionBaseResolver,
    )
    {
    }

    // Bump the member's published version by one semver part; returns the new version.
    public async BumpVersion(member: SolutionMember, part: VersionPart): Promise<string>
    {
        const { factory, storage } = this.versioned(member)
        const next = SemVer.Bump(await factory.getVersion(storage), part)
        await factory.setVersion(storage, next)
        return next
    }

    public async SetVersion(member: SolutionMember, version: string): Promise<void>
    {
        const { factory, storage } = this.versioned(member)
        await factory.setVersion(storage, version)
    }

    // Refresh the member's agent scaffold docs; returns the files written.
    public async UpdateScaffold(member: SolutionMember): Promise<readonly string[]>
    {
        const factory = this.factoryOf(member)
        if (factory === undefined) throw new Error(MemberProjectOps.NoFactoryError)
        if (!supportsScaffold(factory)) throw new Error(MemberProjectOps.NoScaffoldError)
        return factory.updateScaffold(MemberProjectOps.storageOf(member))
    }

    // Drop cached bases for the member (and its dependents) so a republished base is
    // re-resolved. Async because the resolver is keyed by the member's manifest id.
    public async RefreshBases(member: SolutionMember): Promise<void>
    {
        const storage = member.Storage
        if (storage === undefined) return
        const id = await this.resolver.ConsumerIdOf(storage)
        if (id !== undefined) this.resolver.Invalidate(id)
    }

    public FormatsFor(member: SolutionMember): readonly ProjectFileFormat[]
    {
        return this.factoryOf(member)?.formats ?? []
    }

    public IsVersioned(member: SolutionMember): boolean
    {
        const factory = this.factoryOf(member)
        return factory !== undefined && isVersioned(factory)
    }

    public CanRefreshBases(member: SolutionMember): boolean
    {
        return this.factoryOf(member)?.requiresMetaModel === true
    }

    public SupportsScaffold(member: SolutionMember): boolean
    {
        const factory = this.factoryOf(member)
        return factory !== undefined && supportsScaffold(factory)
    }

    public static readonly NoFactoryError = 'Member has no project factory.'
    public static readonly NoVersionError = 'Member project type has no version.'
    public static readonly NoScaffoldError = 'Member project type has no agent scaffold.'
    public static readonly NoStorageError = 'Member has no open storage.'

    private factoryOf(member: SolutionMember): IProjectFactory | undefined
    {
        return this.registry.factoryFor(member.Ref.type)
    }

    private static storageOf(member: SolutionMember): IStorage
    {
        if (member.Storage === undefined) throw new Error(MemberProjectOps.NoStorageError)
        return member.Storage
    }

    private versioned(member: SolutionMember): { factory: IProjectFactory & IVersionedProjectFactory; storage: IStorage }
    {
        const factory = this.factoryOf(member)
        if (factory === undefined) throw new Error(MemberProjectOps.NoFactoryError)
        if (!isVersioned(factory)) throw new Error(MemberProjectOps.NoVersionError)
        return { factory, storage: MemberProjectOps.storageOf(member) }
    }
}
