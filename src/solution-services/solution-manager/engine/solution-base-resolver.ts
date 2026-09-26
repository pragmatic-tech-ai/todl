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
// This is the plain live-first class only — Task 3 layers caching, the
// dependency graph, and the stale signal (Invalidate/StaleMemberIds) on top.
export class SolutionBaseResolver extends ServiceBase implements IPackageSource
{
    public static readonly Key = new ServiceKey<SolutionBaseResolver>('SolutionBaseResolver')

    // DFS resolution path (member ids currently being compiled) — genuine cycles
    // are blocked, diamonds allowed.
    private readonly resolving = new Set<string>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
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
        this.resolving.add(id)
        try
        {
            const model = await new ProjectModelProvider(storage, manifest, this).Compile()
            if (model.package === undefined) return undefined // live-compile failed → published fallback
            return { Document: model.package.document, Dependencies: model.package.document.dependencies ?? [] }
        }
        finally
        {
            this.resolving.delete(id)
        }
    }

    private inner(): IPackageSource
    {
        return this.Provider.get(PackageStoreKey) ?? SolutionBaseResolver.EmptySource
    }

    private static readonly EmptySource: IPackageSource =
        { TryGet(): Promise<SourcedPackage | undefined> { return Promise.resolve(undefined) } }
}

export default SolutionBaseResolver
