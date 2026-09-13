import {
    ServiceBase, ServiceKey,
    type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { type IActivatable } from '@pragmatic-tech-ai/mural/framework'
import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionSession } from './solution-session.js'
import { SolutionManifest } from './solution-manifest.js'
import { type IProjectFactory } from './project-factory.js'

// The seams the manager needs from its host — supplied by the module wiring
// (Configure) in a real app, or by fakes in a test. Kept as an injected object
// so the manager stays testable without the container / dialog / registries.
export interface SolutionSeams {
    // Build a rooted IStorage for an absolute folder (host: StorageProviderRegistry).
    storageForFolder: (folder: string) => IStorage
    // Resolve a project type id to its factory (host: ProjectFactoryRegistry).
    factoryFor: (typeId: string) => IProjectFactory | undefined
    // Save-prompt when replacing a dirty solution; resolves true to discard.
    confirmDiscard: () => Promise<boolean>
}

// Owns exactly ONE active solution (the Visual Studio .sln model): create a new
// empty solution, open/save/close one, and keep a recent-solutions list. Opening
// a solution opens ALL its member projects.
export class SolutionManagerService extends ServiceBase implements IActivatable {
    public static readonly Key = new ServiceKey<SolutionManagerService>('SolutionManager')

    // The host seams are resolved from the container under this key — the app
    // registers a concrete SolutionSeams (storage backend, project factories,
    // discard dialog); a test registers fakes. Resolving through DI keeps the
    // manager free of any public post-construction setter.
    public static readonly SeamsKey = new ServiceKey<SolutionSeams>('SolutionSeams')

    private activeSolution: SolutionSession | undefined
    private readonly recentSolutions: string[] = []
    private readonly seams: SolutionSeams

    constructor(provider: IServiceProvider) {
        super(provider)
        this.seams = provider.get(SolutionManagerService.SeamsKey) ?? SolutionManagerService.throwingSeams()
    }

    public get ActiveSolution(): SolutionSession | undefined {
        return this.activeSolution
    }
    private setActive(s: SolutionSession | undefined): void {
        const old = this.activeSolution
        this.activeSolution = s
        this.RaisePropertyChanged('ActiveSolution', old, s)
    }

    public get RecentSolutions(): readonly string[] {
        return this.recentSolutions
    }

    public async NewSolution(location: string): Promise<void> {
        if (!(await this.canReplace())) return
        const storage = this.seams.storageForFolder(location)
        this.setActive(new SolutionSession('Untitled Solution', storage))
    }

    public async OpenSolution(location: string): Promise<void> {
        if (!(await this.canReplace())) return
        const storage = this.seams.storageForFolder(location)
        const manifest = SolutionManifest.parse(await storage.ReadText('solution.json'))
        const session = new SolutionSession(manifest.name, storage)
        for (const ref of manifest.members) session.AddMember(ref.path, ref.type)
        session.LoadSettings(manifest.settings)
        await session.OpenMembers(
            (rel) => this.seams.storageForFolder(SolutionManagerService.joinPosix(location, rel)),
            (type) => this.seams.factoryFor(type),
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
        const target = this.seams.storageForFolder(location)
        const manifest = new SolutionManifest(s.Name, s.Members.ToArray().map((m) => m.Ref), s.CollectSettings())
        await target.WriteText('solution.json', manifest.stringify())
        const reopened = new SolutionSession(s.Name, target)
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
        return this.seams.confirmDiscard()
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

    private static throwingSeams(): SolutionSeams {
        return {
            storageForFolder: () => { throw new Error('SolutionManagerService not configured') },
            factoryFor: () => undefined,
            confirmDiscard: async () => true,
        }
    }
}
