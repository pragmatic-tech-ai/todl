import { ServiceBase, ServiceKey, type IServiceProvider, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type IPackageSource, type SourcedPackage } from '../../todl-build-system/package-source.js'
import { PackageStoreKey } from '../../todl-build-system/package-store.js'
import { type PackageRef } from '../../../publish/publish.js'
import { ProjectModelProvider } from '../../project-services/generators/project-model-provider.js'
import { ProjectType, type ProjectManifest, parseManifest } from '../../package-manager/manifest.js'
import { PROJECT_MANIFEST_FILENAME } from '../../project-services/core/project-factory.js'
import { SolutionManagerService } from './solution-manager-service.js'

// A live-first IPackageSource: a base ref that names an open, resolved producer
// member of the current solution is compiled from that member's LIVE sources
// (so an unpublished sibling still resolves); every other ref delegates to the
// inner published source (PackageStoreKey). Recursive + cycle-guarded: a member's
// own bases resolve through the same instance. TODL-side, host-free.
//
// Task 3 layers a per-member compile cache, a dependency graph derived from each
// member's own metaModels/libraries bindings, and a stale signal on top: Invalidate
// evicts a member plus its transitive dependents and raises StaleMemberIds so a
// Wave-3 host can react (re-run diagnostics, re-render). The Members-collection
// coarse trigger (any add/remove, or opening a different solution) simply clears
// everything — Wave 1 does not try to patch the graph incrementally.
export class SolutionBaseResolver extends ServiceBase implements IPackageSource
{
    public static readonly Key = new ServiceKey<SolutionBaseResolver>('SolutionBaseResolver')

    private static readonly ActiveSolutionPropertyName = 'ActiveSolution'
    private static readonly StaleMemberIdsPropertyName = 'StaleMemberIds'

    // DFS resolution path (member ids currently being compiled) — genuine cycles
    // are blocked, diamonds allowed.
    private readonly resolving = new Set<string>()

    // The per-member compile cache (keyed by manifest id) and the forward
    // dependency graph it doubles as bookkeeping for: memberId -> the base ids its
    // OWN manifest binds (metaModels + libraries). dependentsOf(id) is the reverse
    // of this map, computed on demand — Wave 1's graph is small enough that a scan
    // per Invalidate is simpler and safer than maintaining a maintained reverse index.
    private readonly cache = new Map<string, SourcedPackage>()
    private readonly baseIdsOf = new Map<string, ReadonlySet<string>>()

    private _staleMemberIds: ReadonlySet<string> = new Set<string>()

    // The live unsubscribe for the current ActiveSolution's Members collection —
    // rewired whenever ActiveSolution itself changes (opening a different solution
    // swaps the Members collection out from under us).
    private membersUnsubscribe: (() => void) | undefined

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.subscribeToManager()
    }

    // The id set evicted by the most recent Invalidate call (empty until the first
    // call). Setting it (via Invalidate) raises PropertyChanged so a host can react.
    public get StaleMemberIds(): ReadonlySet<string>
    {
        return this._staleMemberIds
    }

    // Drop the cached compile for `memberId` and every member that transitively
    // binds it (directly or through another evicted member), then raise
    // StaleMemberIds with exactly that evicted set. The next TryGet/compileMember
    // for any evicted id recompiles from live sources.
    public Invalidate(memberId: string): void
    {
        const evicted = this.withDependents(memberId)
        for (const id of evicted) this.cache.delete(id)
        const old = this._staleMemberIds
        this._staleMemberIds = evicted
        this.RaisePropertyChanged(SolutionBaseResolver.StaleMemberIdsPropertyName, old, evicted)
    }

    public async TryGet(ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        const member = await this.liveProducerFor(ref.id)
        if (member !== undefined && !this.resolving.has(ref.id))
        {
            const live = await this.compileMember(ref.id, member.storage, member.manifest)
            if (live !== undefined) return live
        }
        return this.inner().TryGet(ref)
    }

    // The open, resolved producer member whose manifest id === id, with its parsed
    // manifest; undefined if none (or the member is unresolved / non-producer).
    private async liveProducerFor(id: string): Promise<{ storage: IStorage; manifest: ProjectManifest } | undefined>
    {
        // SolutionManagerService has no direct Members — the members live on
        // ActiveSolution (see Solution.Members). Reading `manager.Members` directly,
        // as an earlier draft of this class did, throws on a real manager (undefined
        // is not iterable); go through ActiveSolution instead.
        const members = this.Provider.get(SolutionManagerService.Key)?.ActiveSolution?.Members
        if (members === undefined) return undefined
        for (const m of members)
        {
            const storage = m.Storage
            if (storage === undefined) continue
            const manifest = parseManifest(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
            if (manifest.id !== id) continue
            if (manifest.type !== ProjectType.MetaModel && manifest.type !== ProjectType.Library) continue
            return { storage, manifest }
        }
        return undefined
    }

    private async compileMember(id: string, storage: IStorage, manifest: ProjectManifest): Promise<SourcedPackage | undefined>
    {
        const cached = this.cache.get(id)
        if (cached !== undefined) return cached
        // Record this member's own base bindings regardless of compile outcome —
        // the graph is about declared bindings, not about whether the compile that
        // read them happened to succeed.
        this.baseIdsOf.set(id, SolutionBaseResolver.baseIdsOf(manifest))
        this.resolving.add(id)
        try
        {
            const model = await new ProjectModelProvider(storage, manifest, this).Compile()
            if (model.package === undefined) return undefined // live-compile failed → published fallback
            const compiled: SourcedPackage = { Document: model.package.document, Dependencies: model.package.document.dependencies ?? [] }
            this.cache.set(id, compiled)
            return compiled
        }
        finally
        {
            this.resolving.delete(id)
        }
    }

    // The ids a manifest itself binds as bases (its metaModels + libraries
    // references) — the forward edge(s) `id -> baseIds` recorded in baseIdsOf.
    private static baseIdsOf(manifest: ProjectManifest): ReadonlySet<string>
    {
        const ids = new Set<string>()
        for (const ref of manifest.metaModels ?? []) ids.add(ref.id)
        for (const ref of manifest.libraries ?? []) ids.add(ref.id)
        return ids
    }

    // The members that directly bind `id` as one of their own bases — the reverse
    // of baseIdsOf, scanned on demand (Wave 1's solutions are small).
    private dependentsOf(id: string): ReadonlySet<string>
    {
        const dependents = new Set<string>()
        for (const [memberId, baseIds] of this.baseIdsOf)
        {
            if (baseIds.has(id)) dependents.add(memberId)
        }
        return dependents
    }

    // BFS over dependentsOf: `memberId` plus every member reachable by following
    // "binds" edges outward — the full transitive-dependent set Invalidate evicts.
    private withDependents(memberId: string): ReadonlySet<string>
    {
        const evicted = new Set<string>()
        const queue: string[] = [memberId]
        while (queue.length > 0)
        {
            const current = queue.shift() as string
            if (evicted.has(current)) continue
            evicted.add(current)
            for (const dependent of this.dependentsOf(current)) queue.push(dependent)
        }
        return evicted
    }

    // Coarse Wave-1 cache-invalidation trigger: clear the cache + graph whenever
    // the active solution's Members collection changes (a member added/removed),
    // and rewire that subscription whenever ActiveSolution itself changes (opening
    // a different solution swaps the Members collection out from under us). Guards
    // against a headless run with no SolutionManagerService registered, and against
    // a lightweight test double that doesn't implement PropertyChanged/Subscribe.
    private subscribeToManager(): void
    {
        const manager = this.Provider.get(SolutionManagerService.Key)
        if (manager === undefined) return
        const propertyChanged = (manager as unknown as { PropertyChanged?: (name: string) => { subscribe: (handler: () => void) => unknown } }).PropertyChanged
        propertyChanged?.call(manager, SolutionBaseResolver.ActiveSolutionPropertyName).subscribe(() => this.rewireMembers(manager))
        this.rewireMembers(manager)
    }

    private rewireMembers(manager: SolutionManagerService): void
    {
        this.membersUnsubscribe?.()
        this.membersUnsubscribe = undefined
        this.clearCache()
        const members = manager.ActiveSolution?.Members as unknown as { Subscribe?: (handler: () => void) => () => void } | undefined
        this.membersUnsubscribe = members?.Subscribe?.(() => this.clearCache())
    }

    private clearCache(): void
    {
        this.cache.clear()
        this.baseIdsOf.clear()
    }

    private inner(): IPackageSource
    {
        return this.Provider.get(PackageStoreKey) ?? SolutionBaseResolver.EmptySource
    }

    private static readonly EmptySource: IPackageSource =
        { TryGet(): Promise<SourcedPackage | undefined> { return Promise.resolve(undefined) } }
}

export default SolutionBaseResolver
