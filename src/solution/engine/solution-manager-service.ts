import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import { ConfirmAsk, type IPromptService } from '@pragmatic-tech-ai/todl-runtime';
import {
    MapPropertyBag,
    SessionStoreKey,
    type PropertyAccessor,
} from '@pragmatic-tech-ai/todl-runtime';
import { Solution } from './solution.js';
import { SolutionManifest } from './solution-manifest.js';
import { SolutionSession } from './solution-session.js';
import {
    ProjectFactoryRegistryKey,
    type IStorageProviderRegistry,
    type IProjectFactoryRegistry,
} from './host-services.js';
import { type INotificationService } from './notification-service.js';
import { type PackageSource, type PackageRef } from '../../domain/domain.js';
import { type Diagnostic } from '../../diagnostics/diagnostic.js';

// Owns exactly ONE active solution (the Visual Studio .sln model): create a new
// empty solution, open/save/close one, and keep a recent-solutions list. Opening
// a solution opens ALL its member projects.
export class SolutionManagerService extends ServiceBase
{
    public static readonly Key = new ServiceKey<SolutionManagerService>('SolutionManager');

    // The host services are resolved from the container by these keys — the app
    // registers concretes at its composition root (storage backend registry,
    // project-factory registry, discard dialog); a test registers fakes.
    // Resolving through DI keeps the manager free of any post-construction setter
    // and free of a lambda "seams" bag.
    public static readonly StorageRegistryKey = new ServiceKey<IStorageProviderRegistry>(
        'SolutionStorageProviderRegistry',
    );
    // Aliased to the standalone `ProjectFactoryRegistryKey` const (same instance) so
    // both this static and a basic module's `.services:` markup name one token.
    public static readonly ProjectFactoryRegistryKey = ProjectFactoryRegistryKey;
    // The user-decision channel: the manager asks the user (e.g. to discard unsaved
    // changes) through IPromptService.Ask, resolved here. Replaces the former
    // single-purpose IDiscardConfirmer seam.
    public static readonly PromptServiceKey = new ServiceKey<IPromptService>(
        'SolutionPromptService',
    );
    // The Domain package backend the composition engine loads members through
    // (app: an IpcPackageSource over the main-side resolver; test: a fake).
    public static readonly PackageSourceKey = new ServiceKey<PackageSource>(
        'SolutionPackageSource',
    );
    // Ambient feedback (status/progress/diagnostics) the manager emits for the host
    // to display. Resolved OPTIONALLY — a headless batch may run without one.
    public static readonly NotificationServiceKey = new ServiceKey<INotificationService>(
        'SolutionNotificationService',
    );

    private activeSolution: Solution | undefined;
    private readonly recentSolutions: string[] = [];
    // The disk root of the last-active saved solution, restored at startup. Empty
    // for an untitled/closed solution — nothing to reopen. Backed by the session bag.
    private lastSolution = '';
    // The session-persisted slice (lastSolution + recentSolutions), registered with
    // the host's SessionStore so it survives across runs.
    private readonly sessionBag: MapPropertyBag;
    private readonly storages: IStorageProviderRegistry;
    private readonly factories: IProjectFactoryRegistry;
    private readonly prompts: IPromptService;
    private readonly packages: PackageSource;
    private readonly notifications: INotificationService | undefined;

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this.storages = provider.getRequired(SolutionManagerService.StorageRegistryKey);
        this.factories = provider.getRequired(SolutionManagerService.ProjectFactoryRegistryKey);
        this.prompts = provider.getRequired(SolutionManagerService.PromptServiceKey);
        this.packages = provider.getRequired(SolutionManagerService.PackageSourceKey);
        this.notifications = provider.get(SolutionManagerService.NotificationServiceKey);
        this.sessionBag = this.buildSessionBag();
        // Optional: a host that persists session state registers a SessionStore; a
        // headless batch or a test omits it, and the bag simply isn't tracked. The
        // store applies any stored slice to the bag on Register (or on its Restore).
        provider.get(SessionStoreKey)?.Register('solution-manager', this.sessionBag);
    }

    // The bag the SessionStore persists: the last-active solution's location and the
    // recent-solutions list. The accessors read/write this manager's own fields, so a
    // restore (bag.SetValue on load) seeds them and a change (pushRecent) notifies.
    private buildSessionBag(): MapPropertyBag
    {
        const accessors = new Map<string, PropertyAccessor>();
        accessors.set('lastSolution', {
            id: () => 'lastSolution',
            displayName: () => 'Last Solution',
            get: () => this.lastSolution,
            set: (v) => {
                this.lastSolution = typeof v === 'string' ? v : '';
            },
        });
        accessors.set('recentSolutions', {
            id: () => 'recentSolutions',
            displayName: () => 'Recent Solutions',
            get: () => [...this.recentSolutions],
            set: (v) =>
                this.setRecent(
                    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [],
                ),
        });
        return new MapPropertyBag(accessors);
    }

    // Compose the given member packages into one Domain graph and return the
    // cross-project diagnostics. Members are Domain refs (a package id + version)
    // the caller resolved by compiling each member first (so it is registered in
    // the local package store the source reads). A fresh SolutionSession per call
    // keeps composition stateless; the caller surfaces the diagnostics.
    public async Compose(members: readonly PackageRef[]): Promise<readonly Diagnostic[]>
    {
        const session = new SolutionSession(this.packages);
        await session.compose(members);
        return session.Diagnostics;
    }

    public get ActiveSolution(): Solution | undefined
    {
        return this.activeSolution;
    }
    private setActive(s: Solution | undefined): void
    {
        const old = this.activeSolution;
        this.activeSolution = s;
        this.RaisePropertyChanged('ActiveSolution', old, s);
    }

    public get RecentSolutions(): readonly string[]
    {
        return this.recentSolutions;
    }

    public async NewSolution(location: string): Promise<void>
    {
        if (!(await this.canReplace())) return;
        const storage = this.storages.CreateStorage(location);
        this.setActive(new Solution('Untitled Solution', storage));
    }

    // Create an empty, unsaved solution with no on-disk location. Created at startup
    // when no previous solution is remembered, and used as the fallback when a
    // remembered solution fails to open. Not added to recents and clears lastSolution
    // (nothing to reopen) — the user roots it with Save As, or discards it on close.
    public async NewUntitledSolution(): Promise<void>
    {
        if (!(await this.canReplace())) return;
        this.setActive(new Solution('Untitled Solution'));
        this.sessionBag.SetValue('lastSolution', '');
    }

    // Startup: reopen the remembered solution, else create an empty untitled one. The
    // session slice (lastSolution + recentSolutions) is already applied to the bag by
    // the SessionStore — on Register, or on its Restore — before this runs.
    public async RestoreSession(): Promise<void>
    {
        const last = this.lastSolution;
        if (last !== '')
        {
            try
            {
                await this.OpenSolution(last);
                if (this.ActiveSolution !== undefined) return;
            }
            catch
            {
                // The remembered folder is gone or its manifest is unreadable: drop it
                // from recents and fall through to an untitled solution.
                this.sessionBag.SetValue(
                    'recentSolutions',
                    this.recentSolutions.filter((p) => p !== last),
                );
                this.sessionBag.SetValue('lastSolution', '');
            }
        }
        await this.NewUntitledSolution();
    }

    public async OpenSolution(location: string): Promise<void>
    {
        if (!(await this.canReplace())) return;
        const storage = this.storages.CreateStorage(location);
        const manifest = SolutionManifest.parse(await storage.ReadText('solution.json'));
        const session = new Solution(manifest.name, storage);
        for (const ref of manifest.members) session.AddMember(ref.path, ref.type);
        session.LoadSettings(manifest.settings);
        await session.OpenMembers(
            (rel) => this.storages.CreateStorage(SolutionManagerService.joinPosix(location, rel)),
            (type) => this.factories.factoryFor(type),
        );
        session.IsDirty = false;
        this.setActive(session);
        this.pushRecent(location);
    }

    public async Save(): Promise<void>
    {
        const s = this.ActiveSolution;
        if (s === undefined) return;
        const storage = s.Storage;
        if (storage === undefined)
        {
            // Untitled — pick a folder and persist there as a real solution (Save As).
            const location = await this.prompts.PickFolder('Save Solution As');
            if (location !== undefined) await this.SaveAs(location);
            return;
        }
        const manifest = new SolutionManifest(
            s.Name,
            s.Members.ToArray().map((m) => m.Ref),
            s.CollectSettings(),
        );
        await storage.WriteText('solution.json', manifest.stringify());
        s.IsDirty = false;
        this.pushRecent(storage.Root);
        this.notifications?.Status('Saved.');
    }

    public async SaveAs(location: string): Promise<void>
    {
        const s = this.ActiveSolution;
        if (s === undefined) return;
        const target = this.storages.CreateStorage(location);
        const manifest = new SolutionManifest(
            s.Name,
            s.Members.ToArray().map((m) => m.Ref),
            s.CollectSettings(),
        );
        await target.WriteText('solution.json', manifest.stringify());
        const reopened = new Solution(s.Name, target);
        for (const m of s.Members) reopened.AddMember(m.Ref.path, m.Ref.type);
        reopened.LoadSettings(s.CollectSettings());
        reopened.IsDirty = false;
        this.setActive(reopened);
        this.pushRecent(location);
    }

    public async CloseSolution(): Promise<void>
    {
        if (!(await this.canReplace())) return;
        this.setActive(undefined);
        this.sessionBag.SetValue('lastSolution', '');
    }

    private async canReplace(): Promise<boolean>
    {
        const s = this.ActiveSolution;
        if (s === undefined || !s.IsDirty) return true;
        return this.prompts.Ask(
            new ConfirmAsk('The current solution has unsaved changes. Discard them?', 'Discard'),
        );
    }

    // Record a solution's disk root as the most-recent entry (move-to-front, deduped)
    // and remember it as the last-active solution. Routed through the session bag so
    // both changes persist (the SessionStore schedules a debounced save) in one place.
    private pushRecent(location: string): void
    {
        const next = this.recentSolutions.filter((p) => p !== location);
        next.unshift(location);
        this.sessionBag.SetValue('recentSolutions', next);
        this.sessionBag.SetValue('lastSolution', location);
    }

    // Replace the recent-solutions list in place and notify. Invoked by the session
    // bag's writable accessor — on restore (stored slice applied) and on pushRecent.
    private setRecent(list: readonly string[]): void
    {
        this.recentSolutions.splice(0, this.recentSolutions.length, ...list);
        this.RaisePropertyChanged('RecentSolutions', undefined, this.recentSolutions);
    }

    // POSIX-join a solution folder with a member's relative path, collapsing
    // './' and '../'. Keeps a leading '/' for absolute roots.
    private static joinPosix(base: string, rel: string): string
    {
        const parts = base.split(/[\\/]+/).filter((s) => s.length > 0);
        for (const seg of rel.split(/[\\/]+/))
        {
            if (seg === '' || seg === '.') continue;
            if (seg === '..') parts.pop();
            else parts.push(seg);
        }
        return (base.startsWith('/') ? '/' : '') + parts.join('/');
    }
}
