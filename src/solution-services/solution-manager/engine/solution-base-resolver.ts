import { ServiceBase, ServiceKey, type IServiceProvider, type IStorage, type IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import { type IPackageSource, type SourcedPackage, type PackageResolutionContext } from '../../todl-build-system/package-source.js'
import { PackageStoreKey } from '../../todl-build-system/package-store.js'
import { PackageKind, type PackageRef } from '../../../publish/publish.js'
import { type TodlDocument } from '../../../compiler-services/emit/json.js'
import { ProjectModelProvider } from '../../project-services/generators/project-model-provider.js'
import { type ProjectModel } from '../../project-services/generators/project-content-generator.js'
import { ProjectType, type ProjectManifest, type DependencyRef, parseManifest } from '../../package-manager/manifest.js'
import { PROJECT_MANIFEST_FILENAME } from '../../project-services/core/project-factory.js'
import { WikiLocator, type WikiOrigin } from '../../project-services/core/wiki-origin.js'
import { type IBaseResolver } from './i-base-resolver.js'
import { SolutionManagerService } from './solution-manager-service.js'

// A resolved base document paired with the live producer storage that contributed
// it (undefined for a published-origin document). Carried internally through the
// recursive resolution so the FINAL closure can flatten a live diamond's shared
// producer down to a single contribution — via dedupeLiveBases, by producer
// identity — while every intermediate CompileWithBases call along the way still
// sees that producer's COMPLETE content: nothing is gated mid-recursion, so a
// second branch reaching the same open producer still gets it in its own compile
// inputs; only the very top collapses the resulting duplicates.
interface LiveBase
{
    document: TodlDocument
    producer: IStorage | undefined
}

// A live-first IPackageSource: a base ref that names an open, resolved producer
// member of the current solution is compiled from that member's LIVE sources
// (so an unpublished sibling still resolves); every other ref delegates to the
// inner published source (PackageStoreKey). Recursive + cycle-guarded: a member's
// own bases resolve through the same instance. TODL-side, host-free.
//
// Task 3 layers a per-member compile cache, a dependency graph derived from each
// member's own metaModels/libraries bindings, and a stale signal on top: Invalidate
// evicts a member plus its transitive dependents and raises StaleMemberIds so a
// Wave-3 host can react (re-run diagnostics, re-render). Task 13 drives that targeted
// Invalidate from the SolutionLanguageService on each solution lifecycle event, so
// the coarse "clear everything on any Members change" trigger is gone: the only
// remaining blanket clear is the ActiveSolution switch (opening a different solution
// swaps the whole member set out, so nothing cached can survive it).
export class SolutionBaseResolver extends ServiceBase implements IPackageSource, IBaseResolver
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

    // The ActiveSolution subscription on the manager, released on dispose so this
    // resolver (e.g. a transitional manager-owned fallback) does not outlive the
    // manager via a dangling listener. (#18)
    private managerSubscription: IDisposable | undefined

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this.subscribeToManager()
    }

    public override dispose(): void
    {
        this.managerSubscription?.dispose()
        this.managerSubscription = undefined
        super.dispose()
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

    // The live version an open in-solution member produces for `id`, so a
    // version-less reference to an unpublished member can still pin to it (#17).
    // Empty when no open member produces `id` or it has no version yet; the
    // published backend's versions are merged in by the caller.
    public async VersionsOf(id: string): Promise<readonly string[]>
    {
        const member = await this.liveProducerFor(id)
        const version = member?.manifest.packageVersion
        return version === undefined ? [] : [version]
    }

    // Resolve a consumer's declared bases local-first (open solution members compiled
    // live, preferred over published), tagging each base node with where its declaring
    // artifact lives. The editor-facing counterpart of TryGet: it merges the full base
    // closure a language server validates against and surfaces resolution diagnostics.
    public async ResolveBasesFor(consumerStorage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[]; originOf: ReadonlyMap<string, WikiOrigin> }>
    {
        const manifest = await this.readManifest(consumerStorage)
        if (manifest === undefined) return { bases: [], problems: [], originOf: new Map() }
        // Carry the consumer's id as the resolution context so an app-side connection-aware
        // published source can pick THIS project's effective connection for every published
        // base in the closure (the top consumer owns the whole closure's registry choice). A
        // producer is identified by its package id; an architecture (no id) by its name, so the
        // closure still carries a consumer identity the app can match to a member.
        const context: PackageResolutionContext = { consumerId: SolutionBaseResolver.consumerIdOf(manifest) }
        const resolved = await this.resolveBindingsInto(consumerStorage, manifest, new Set<IStorage>([consumerStorage]), new Set<string>(), context)
        return { bases: SolutionBaseResolver.dedupeLiveBases(resolved.bases), problems: resolved.problems, originOf: resolved.originOf }
    }

    // The transitive set of published base package keys (`id@version`) a project
    // references — its manifest's meta-model + library bindings plus each published
    // package's recorded dependencies. Published-only (does NOT consult open members):
    // it is the toolbox-scoping closure. Best-effort — an absent ref contributes its
    // own key; only its transitive deps are then unreachable.
    public async ReferencedPublishedRefs(consumerStorage: IStorage): Promise<Set<string>>
    {
        const manifest = await this.readManifest(consumerStorage)
        const out = new Set<string>()
        for (const ref of manifest?.metaModels ?? []) await this.collectPublishedRef(ref, ProjectType.MetaModel, out)
        for (const ref of manifest?.libraries ?? []) await this.collectPublishedRef(ref, ProjectType.Library, out)
        return out
    }

    // Every open, resolved member producing a base of `kind`, as { id, version } —
    // the References-manager catalog. A sibling can be referenced before it is
    // published (resolution prefers the open producer); a producer with no version
    // yet is skipped, since a reference needs a concrete version to record.
    public async WorkspaceProducers(kind: ProjectType): Promise<readonly DependencyRef[]>
    {
        const members = this.Provider.get(SolutionManagerService.Key)?.ActiveSolution?.Members
        if (members === undefined) return []
        const refs: DependencyRef[] = []
        for (const m of members)
        {
            const storage = m.Storage
            if (storage === undefined) continue
            const manifest = await this.readManifest(storage)
            if (manifest === undefined || manifest.type !== kind) continue
            if (manifest.id === undefined || manifest.packageVersion === undefined) continue
            refs.push({ id: manifest.id, version: manifest.packageVersion })
        }
        return refs
    }

    // The producer id a storage's manifest declares (meta-model or library), else
    // undefined.
    public async ProducedIdOf(consumerStorage: IStorage): Promise<string | undefined>
    {
        const manifest = await this.readManifest(consumerStorage)
        if (manifest === undefined) return undefined
        if (manifest.type !== ProjectType.MetaModel && manifest.type !== ProjectType.Library) return undefined
        return manifest.id
    }

    // The identity a consumer carries as its resolution context (see ResolveBasesFor) and the
    // app matches back to a member to pick that member's effective connection: a producer's
    // package id, else (an architecture, which has no id) its name. Every valid manifest yields
    // one, so an architecture project is no longer resolution-anonymous.
    public async ConsumerIdOf(consumerStorage: IStorage): Promise<string | undefined>
    {
        const manifest = await this.readManifest(consumerStorage)
        return manifest === undefined ? undefined : SolutionBaseResolver.consumerIdOf(manifest)
    }

    private static consumerIdOf(manifest: ProjectManifest): string
    {
        return manifest.id ?? manifest.name
    }

    private async collectPublishedRef(ref: DependencyRef, kind: ProjectType, out: Set<string>): Promise<void>
    {
        const key = `${ref.id}@${ref.version}`
        if (out.has(key)) return
        out.add(key)
        const sourced = await this.inner().TryGet({ kind: SolutionBaseResolver.packageKindOf(kind), id: ref.id, version: ref.version })
        if (sourced === undefined) return
        for (const dep of sourced.Dependencies)
        {
            const depKind = dep.kind === PackageKind.Library ? ProjectType.Library : ProjectType.MetaModel
            await this.collectPublishedRef({ id: dep.id, version: dep.version }, depKind, out)
        }
    }

    private async resolveBindingsInto(storage: IStorage, manifest: ProjectManifest, path: Set<IStorage>, seenPub: Set<string>, context: PackageResolutionContext): Promise<{ bases: LiveBase[]; problems: string[]; originOf: Map<string, WikiOrigin> }>
    {
        const bases: LiveBase[] = []
        const problems: string[] = []
        const originOf = new Map<string, WikiOrigin>()
        for (const ref of manifest.metaModels ?? [])
            await this.resolveOneBase(ref, ProjectType.MetaModel, storage, path, seenPub, bases, problems, originOf, context)
        for (const ref of manifest.libraries ?? [])
            await this.resolveOneBase(ref, ProjectType.Library, storage, path, seenPub, bases, problems, originOf, context)
        return { bases, problems, originOf }
    }

    private async resolveOneBase(
        ref: DependencyRef, kind: ProjectType, consumerStorage: IStorage,
        path: Set<IStorage>, seenPub: Set<string>,
        bases: LiveBase[], problems: string[], originOf: Map<string, WikiOrigin>,
        context: PackageResolutionContext,
    ): Promise<void>
    {
        // A binding's `kind` (metaModels vs libraries) says which array the consumer
        // declared the ref under, not what the producer's own manifest.type must be —
        // a manifest may name a ref under either list independent of the target's own
        // declared type (e.g. a library binding another library's own self-reference).
        // liveProducerFor's own type gate (producer vs non-producer) is the only
        // filter that applies here; matching further on `kind` would make a producer
        // whose declared type differs from the binding's array invisible to the DFS,
        // silently disabling cycle detection for it.
        const producer = await this.liveProducerFor(ref.id)
        if (producer !== undefined && producer.storage !== consumerStorage && !path.has(producer.storage))
        {
            // DFS path (not a global seen-set): add on entry, remove on backtrack —
            // catches genuine cycles while allowing diamonds.
            path.add(producer.storage)
            // Deliberately NOT deduped against anything seen elsewhere in the tree:
            // this producer's OWN CompileWithBases below needs its COMPLETE transitive
            // base content regardless of whether a sibling branch already resolved the
            // same shared dependency — starving this call to avoid a later duplicate
            // was the Task-1-round-1 regression (a diamond's second branch compiled
            // against an incomplete closure and silently lost its own base). The
            // closure-level dedup happens exactly once, at the very end, in
            // dedupeLiveBases — never here.
            const child = await this.resolveBindingsInto(producer.storage, producer.manifest, path, seenPub, context)
            path.delete(producer.storage)
            problems.push(...child.problems)
            // A live compile can fail two ways: softly (model.errors non-empty, no
            // package) or by THROWING synchronously (e.g. compilePackage → Builder.commit
            // on a colliding node id). Either way the base must not be lost — catch the
            // throw, record it as a problem exactly like a soft failure, and fall through
            // to the published copy below.
            let model: ProjectModel | undefined
            try
            {
                model = await new ProjectModelProvider(producer.storage, producer.manifest, this).CompileLocalWithBases(child.bases.map((b) => b.document))
            }
            catch (err)
            {
                problems.push(SolutionBaseResolver.localProblem(kind, ref.id, SolutionBaseResolver.messageOf(err)))
            }
            if (model !== undefined)
            {
                for (const e of model.errors) problems.push(SolutionBaseResolver.localProblem(kind, ref.id, e))
                const producerVersion = producer.manifest.packageVersion
                if (producerVersion !== undefined && producerVersion !== ref.version)
                    problems.push(SolutionBaseResolver.versionMismatch(ref.id, ref.version, producerVersion))
                if (model.package !== undefined)
                {
                    bases.push({ document: model.package.document, producer: producer.storage })
                    SolutionBaseResolver.tagOrigin(originOf, model.package.document, WikiLocator.OpenProjectOrigin(producer.storage))
                    // Flatten the producer's OWN transitive live (+ published) base
                    // closure into ours too — symmetric with the published branch below
                    // (resolvePublishedBase's recursion into sourced.Dependencies): an
                    // open producer contributes its own transitive bases, not just its
                    // own document. Each entry still carries its own producer tag, so a
                    // diamond's shared dependency collapses to one contribution only
                    // once dedupeLiveBases runs at the top — never mid-flatten.
                    for (const b of child.bases) bases.push(b)
                    SolutionBaseResolver.mergeOrigins(originOf, child.originOf)
                    return
                }
            }
            // live compile failed (soft or thrown) → fall through to the published copy so the base isn't lost
        }
        else if (producer !== undefined && path.has(producer.storage))
        {
            problems.push(SolutionBaseResolver.cyclicProblem(ref.id))
        }
        await this.resolvePublishedBase(ref, kind, seenPub, bases, problems, originOf, context)
    }

    private async resolvePublishedBase(
        ref: DependencyRef, kind: ProjectType, seenPub: Set<string>,
        bases: LiveBase[], problems: string[], originOf: Map<string, WikiOrigin>,
        context: PackageResolutionContext,
    ): Promise<void>
    {
        const key = `${kind}:${ref.id}@${ref.version}`
        if (seenPub.has(key)) return
        seenPub.add(key)
        const sourced = await this.inner().TryGet({ kind: SolutionBaseResolver.packageKindOf(kind), id: ref.id, version: ref.version }, context)
        if (sourced === undefined)
        {
            problems.push(SolutionBaseResolver.notPublished(kind, ref.id, ref.version))
            return
        }
        // No producer tag (undefined): a published package is fetched at most once
        // per id@version already (the seenPub guard just above), so it needs no
        // further dedup at the dedupeLiveBases step.
        bases.push({ document: { nodes: sourced.Document.nodes, edges: sourced.Document.edges }, producer: undefined })
        SolutionBaseResolver.tagOrigin(originOf, sourced.Document, WikiLocator.PackageOrigin(ref.id, ref.version))
        for (const dep of sourced.Dependencies)
        {
            const depKind = dep.kind === PackageKind.Library ? ProjectType.Library : ProjectType.MetaModel
            await this.resolvePublishedBase({ id: dep.id, version: dep.version }, depKind, seenPub, bases, problems, originOf, context)
        }
    }

    private async readManifest(storage: IStorage): Promise<ProjectManifest | undefined>
    {
        try { return parseManifest(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) }
        catch { return undefined }
    }

    private static packageKindOf(kind: ProjectType): PackageKind
    {
        return kind === ProjectType.Library ? PackageKind.Library : PackageKind.MetaModel
    }

    // Safe message extraction from a caught live-compile exception (e.g. a
    // Builder.commit invariant throw) — never re-throws, always yields a string.
    private static messageOf(err: unknown): string
    {
        return err instanceof Error ? err.message : String(err)
    }

    // First-writer-wins: a node reached first via a live-producer binding keeps that
    // origin over a later published-diamond reach.
    private static tagOrigin(originOf: Map<string, WikiOrigin>, doc: TodlDocument, origin: WikiOrigin): void
    {
        for (const n of doc.nodes) if (!originOf.has(n.id)) originOf.set(n.id, origin)
    }

    // The same first-writer-wins idiom as tagOrigin, merging an already-built origin
    // map (a child closure's) into the caller's instead of tagging a single document.
    private static mergeOrigins(originOf: Map<string, WikiOrigin>, child: ReadonlyMap<string, WikiOrigin>): void
    {
        for (const [id, origin] of child) if (!originOf.has(id)) originOf.set(id, origin)
    }

    // The ONE dedup pass for the whole resolved tree, run once at the top
    // (ResolveBasesFor) after every producer's own compile has already seen its
    // complete, ungated closure: a live diamond's shared producer (same IStorage
    // reached via more than one binding path) contributes its document exactly
    // once — first path to resolve it wins. A published-origin entry (producer
    // undefined) is never deduped here — resolvePublishedBase's own seenPub key
    // already ensures it is fetched, and so pushed, at most once.
    private static dedupeLiveBases(bases: readonly LiveBase[]): TodlDocument[]
    {
        const seenProducers = new Set<IStorage>()
        const documents: TodlDocument[] = []
        for (const base of bases)
        {
            if (base.producer !== undefined)
            {
                if (seenProducers.has(base.producer)) continue
                seenProducers.add(base.producer)
            }
            documents.push(base.document)
        }
        return documents
    }

    private static localProblem(kind: ProjectType, id: string, detail: string): string
    {
        return `local ${kind} "${id}" — ${detail}`
    }
    private static versionMismatch(id: string, requested: string, actual: string): string
    {
        return `using local "${id}" (open project) — binding requests @${requested}, project is @${actual}`
    }
    private static cyclicProblem(id: string): string
    {
        return `cyclic local reference to "${id}"; using published`
    }
    private static notPublished(kind: ProjectType, id: string, version: string): string
    {
        return `${kind} "${id}@${version}" is not published`
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
            const model = await new ProjectModelProvider(storage, manifest, this).CompileLocal()
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

    // The ONLY remaining blanket cache clear: the ActiveSolution switch. Opening a
    // different solution swaps the entire member set out, so every cached compile and
    // every graph edge is stale at once — clear them. Incremental per-member changes
    // (add/remove/reference edits) are handled by the SolutionLanguageService driving
    // the targeted Invalidate instead; this class no longer subscribes to the Members
    // collection for a coarse clear. Guards against a headless run with no
    // SolutionManagerService registered, and against a lightweight test double that
    // doesn't implement PropertyChanged.
    private subscribeToManager(): void
    {
        const manager = this.Provider.get(SolutionManagerService.Key)
        if (manager === undefined) return
        const propertyChanged = (manager as unknown as { PropertyChanged?: (name: string) => { subscribe: (handler: () => void) => IDisposable } }).PropertyChanged
        this.managerSubscription = propertyChanged?.call(manager, SolutionBaseResolver.ActiveSolutionPropertyName).subscribe(() => this.clearCache())
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
