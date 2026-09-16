import {
    ServiceBase, ServiceKey,
    type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { type IActivatable } from '@pragmatic-tech-ai/mural/framework'
import { SolutionViewService } from './solution-view-service.js'
import { SolutionManifest } from './solution-manifest.js'
import {
    type IStorageProviderRegistry,
    type IProjectFactoryRegistry,
    type IDiscardConfirmer,
} from './host-services.js'

// Owns exactly ONE active solution (the Visual Studio .sln model): create a new
// empty solution, open/save/close one, and keep a recent-solutions list. Opening
// a solution opens ALL its member projects.
export class SolutionManagerService extends ServiceBase implements IActivatable {
    public static readonly Key = new ServiceKey<SolutionManagerService>('SolutionManager')

    // The host services are resolved from the container by these keys — the app
    // registers concretes at its composition root (storage backend registry,
    // project-factory registry, discard dialog); a test registers fakes.
    // Resolving through DI keeps the manager free of any post-construction setter
    // and free of a lambda "seams" bag.
    public static readonly StorageRegistryKey =
        new ServiceKey<IStorageProviderRegistry>('SolutionStorageProviderRegistry')
    public static readonly ProjectFactoryRegistryKey =
        new ServiceKey<IProjectFactoryRegistry>('SolutionProjectFactoryRegistry')
    public static readonly DiscardConfirmerKey =
        new ServiceKey<IDiscardConfirmer>('SolutionDiscardConfirmer')

    private activeSolution: SolutionViewService | undefined
    private readonly recentSolutions: string[] = []
    private readonly storages: IStorageProviderRegistry
    private readonly factories: IProjectFactoryRegistry
    private readonly confirmer: IDiscardConfirmer

    constructor(provider: IServiceProvider) {
        super(provider)
        this.storages = provider.getRequired(SolutionManagerService.StorageRegistryKey)
        this.factories = provider.getRequired(SolutionManagerService.ProjectFactoryRegistryKey)
        this.confirmer = provider.getRequired(SolutionManagerService.DiscardConfirmerKey)
    }

    public get ActiveSolution(): SolutionViewService | undefined {
        return this.activeSolution
    }
    private setActive(s: SolutionViewService | undefined): void {
        const old = this.activeSolution
        this.activeSolution = s
        this.RaisePropertyChanged('ActiveSolution', old, s)
    }

    public get RecentSolutions(): readonly string[] {
        return this.recentSolutions
    }

    public async NewSolution(location: string): Promise<void> {
        if (!(await this.canReplace())) return
        const storage = this.storages.CreateStorage(location)
        this.setActive(new SolutionViewService('Untitled Solution', storage))
    }

    public async OpenSolution(location: string): Promise<void> {
        if (!(await this.canReplace())) return
        const storage = this.storages.CreateStorage(location)
        const manifest = SolutionManifest.parse(await storage.ReadText('solution.json'))
        const session = new SolutionViewService(manifest.name, storage)
        for (const ref of manifest.members) session.AddMember(ref.path, ref.type)
        session.LoadSettings(manifest.settings)
        await session.OpenMembers(
            (rel) => this.storages.CreateStorage(SolutionManagerService.joinPosix(location, rel)),
            (type) => this.factories.factoryFor(type),
        )
        session.IsDirty = false
        this.setActive(session)
        this.pushRecent(location)
    }

    public async Save(): Promise<void> {
        const s = this.ActiveSolution
        if (s === undefined) return
        const manifest = new SolutionManifest(s.Name, s.Members.ToArray().map((m) => m.Ref), s.CollectSettings())
        await s.Storage.WriteText('solution.json', manifest.stringify())
        s.IsDirty = false
        this.pushRecent(s.Storage.Root)
    }

    public async SaveAs(location: string): Promise<void> {
        const s = this.ActiveSolution
        if (s === undefined) return
        const target = this.storages.CreateStorage(location)
        const manifest = new SolutionManifest(s.Name, s.Members.ToArray().map((m) => m.Ref), s.CollectSettings())
        await target.WriteText('solution.json', manifest.stringify())
        const reopened = new SolutionViewService(s.Name, target)
        for (const m of s.Members) reopened.AddMember(m.Ref.path, m.Ref.type)
        reopened.LoadSettings(s.CollectSettings())
        reopened.IsDirty = false
        this.setActive(reopened)
        this.pushRecent(location)
    }

    public async CloseSolution(): Promise<void> {
        if (!(await this.canReplace())) return
        this.setActive(undefined)
    }

    public OnActivated(): void { /* content-host wiring lands with the module/views */ }

    private async canReplace(): Promise<boolean> {
        const s = this.ActiveSolution
        if (s === undefined || !s.IsDirty) return true
        return this.confirmer.confirmDiscard()
    }

    private pushRecent(location: string): void {
        const existing = this.recentSolutions.indexOf(location)
        if (existing >= 0) this.recentSolutions.splice(existing, 1)
        this.recentSolutions.unshift(location)
        this.RaisePropertyChanged('RecentSolutions', undefined, this.recentSolutions)
    }

    // POSIX-join a solution folder with a member's relative path, collapsing
    // './' and '../'. Keeps a leading '/' for absolute roots.
    private static joinPosix(base: string, rel: string): string {
        const parts = base.split(/[\\/]+/).filter((s) => s.length > 0)
        for (const seg of rel.split(/[\\/]+/)) {
            if (seg === '' || seg === '.') continue
            if (seg === '..') parts.pop()
            else parts.push(seg)
        }
        return (base.startsWith('/') ? '/' : '') + parts.join('/')
    }
}
