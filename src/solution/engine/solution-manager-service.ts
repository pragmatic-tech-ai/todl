import {
    ServiceBase, ServiceKey,
    type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { type IActivatable } from '@pragmatic-tech-ai/mural/framework'
import { ConfirmAsk, type IPromptService } from '@pragmatic-tech-ai/todl-runtime'
import { Solution } from './solution.js'
import { SolutionManifest } from './solution-manifest.js'
import { SolutionSession } from './solution-session.js'
import {
    type IStorageProviderRegistry,
    type IProjectFactoryRegistry,
} from './host-services.js'
import { type INotificationService } from './notification-service.js'
import { type PackageSource, type PackageRef } from '../../domain/domain.js'
import { type Diagnostic } from '../../diagnostics/diagnostic.js'

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
    // The user-decision channel: the manager asks the user (e.g. to discard unsaved
    // changes) through IPromptService.Ask, resolved here. Replaces the former
    // single-purpose IDiscardConfirmer seam.
    public static readonly PromptServiceKey =
        new ServiceKey<IPromptService>('SolutionPromptService')
    // The Domain package backend the composition engine loads members through
    // (app: an IpcPackageSource over the main-side resolver; test: a fake).
    public static readonly PackageSourceKey =
        new ServiceKey<PackageSource>('SolutionPackageSource')
    // Ambient feedback (status/progress/diagnostics) the manager emits for the host
    // to display. Resolved OPTIONALLY — a headless batch may run without one.
    public static readonly NotificationServiceKey =
        new ServiceKey<INotificationService>('SolutionNotificationService')

    private activeSolution: Solution | undefined
    private readonly recentSolutions: string[] = []
    private readonly storages: IStorageProviderRegistry
    private readonly factories: IProjectFactoryRegistry
    private readonly prompts: IPromptService
    private readonly packages: PackageSource
    private readonly notifications: INotificationService | undefined

    constructor(provider: IServiceProvider) {
        super(provider)
        this.storages = provider.getRequired(SolutionManagerService.StorageRegistryKey)
        this.factories = provider.getRequired(SolutionManagerService.ProjectFactoryRegistryKey)
        this.prompts = provider.getRequired(SolutionManagerService.PromptServiceKey)
        this.packages = provider.getRequired(SolutionManagerService.PackageSourceKey)
        this.notifications = provider.get(SolutionManagerService.NotificationServiceKey)
    }

    // Compose the given member packages into one Domain graph and return the
    // cross-project diagnostics. Members are Domain refs (a package id + version)
    // the caller resolved by compiling each member first (so it is registered in
    // the local package store the source reads). A fresh SolutionSession per call
    // keeps composition stateless; the caller surfaces the diagnostics.
    public async Compose(members: readonly PackageRef[]): Promise<readonly Diagnostic[]> {
        const session = new SolutionSession(this.packages)
        await session.compose(members)
        return session.Diagnostics
    }

    public get ActiveSolution(): Solution | undefined {
        return this.activeSolution
    }
    private setActive(s: Solution | undefined): void {
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
        this.setActive(new Solution('Untitled Solution', storage))
    }

    public async OpenSolution(location: string): Promise<void> {
        if (!(await this.canReplace())) return
        const storage = this.storages.CreateStorage(location)
        const manifest = SolutionManifest.parse(await storage.ReadText('solution.json'))
        const session = new Solution(manifest.name, storage)
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
        this.notifications?.Status('Saved.')
    }

    public async SaveAs(location: string): Promise<void> {
        const s = this.ActiveSolution
        if (s === undefined) return
        const target = this.storages.CreateStorage(location)
        const manifest = new SolutionManifest(s.Name, s.Members.ToArray().map((m) => m.Ref), s.CollectSettings())
        await target.WriteText('solution.json', manifest.stringify())
        const reopened = new Solution(s.Name, target)
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
        return this.prompts.Ask(new ConfirmAsk('The current solution has unsaved changes. Discard them?', 'Discard'))
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
