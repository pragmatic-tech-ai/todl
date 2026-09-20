import {
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
    type IStorage,
} from '@pragmatic-tech-ai/todl-runtime';
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
import { type PackageSource, type PackageRef } from '../../../domain/domain.js';
import { type Diagnostic } from '../../../diagnostics/diagnostic.js';

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

    // Fixed text and keys hoisted out of the method bodies (no inline string
    // literals): user-facing strings live in one place, and the session property
    // names are shared between the bag accessors and the SetValue call sites so the
    // two can't drift.
    // The default name for a solution the user has not named yet. The manifest file
    // is `<name>.<ManifestFileExtension>` (e.g. "Default Solution.pksln"), so a
    // rename changes the file name — see manifestFileName / Rename.
    private static readonly UntitledName = 'Default Solution';
    private static readonly ManifestFileExtension = 'pksln';
    private static readonly SaveAsPrompt = 'Save Solution As';
    private static readonly DiscardMessage =
        'The current solution has unsaved changes. Discard them?';
    private static readonly DiscardConfirmLabel = 'Discard';
    private static readonly SavedStatus = 'Saved.';
    private static readonly SessionRegistrationKey = 'solution-manager';
    private static readonly LastSolutionName = 'lastSolution';
    private static readonly LastSolutionLabel = 'Last Solution';
    private static readonly RecentSolutionsName = 'recentSolutions';
    private static readonly RecentSolutionsLabel = 'Recent Solutions';
    // INPC property names (match the public getters) raised for view-model binding.
    private static readonly ActiveSolutionChangeName = 'ActiveSolution';
    private static readonly RecentSolutionsChangeName = 'RecentSolutions';

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
        provider
            .get(SessionStoreKey)
            ?.Register(SolutionManagerService.SessionRegistrationKey, this.sessionBag);
    }

    // The bag the SessionStore persists: the last-active solution's location and the
    // recent-solutions list. The accessors read/write this manager's own fields, so a
    // restore (bag.SetValue on load) seeds them and a change (pushRecent) notifies.
    private buildSessionBag(): MapPropertyBag
    {
        const accessors = new Map<string, PropertyAccessor>();
        accessors.set(SolutionManagerService.LastSolutionName, {
            id: () => SolutionManagerService.LastSolutionName,
            displayName: () => SolutionManagerService.LastSolutionLabel,
            get: () => this.lastSolution,
            set: (v) => {
                this.lastSolution = typeof v === 'string' ? v : '';
            },
        });
        accessors.set(SolutionManagerService.RecentSolutionsName, {
            id: () => SolutionManagerService.RecentSolutionsName,
            displayName: () => SolutionManagerService.RecentSolutionsLabel,
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
        this.RaisePropertyChanged(SolutionManagerService.ActiveSolutionChangeName, old, s);
    }

    public get RecentSolutions(): readonly string[]
    {
        return this.recentSolutions;
    }

    public async NewSolution(
        location: string,
        name: string = SolutionManagerService.UntitledName,
    ): Promise<void>
    {
        if (!(await this.canReplace())) return;
        const storage = this.storages.CreateStorage(location);
        this.setActive(new Solution(name, storage));
    }

    // Create an empty, unsaved solution with no on-disk location. Created at startup
    // when no previous solution is remembered, and used as the fallback when a
    // remembered solution fails to open. Not added to recents and clears lastSolution
    // (nothing to reopen) — the user roots it with Save As, or discards it on close.
    public async NewUntitledSolution(
        name: string = SolutionManagerService.UntitledName,
    ): Promise<void>
    {
        if (!(await this.canReplace())) return;
        this.setActive(new Solution(name));
        this.sessionBag.SetValue(SolutionManagerService.LastSolutionName, '');
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
                    SolutionManagerService.RecentSolutionsName,
                    this.recentSolutions.filter((p) => p !== last),
                );
                this.sessionBag.SetValue(SolutionManagerService.LastSolutionName, '');
            }
        }
        await this.NewUntitledSolution();
    }

    public async OpenSolution(location: string): Promise<void>
    {
        if (!(await this.canReplace())) return;
        const storage = this.storages.CreateStorage(location);
        const manifestFile = await this.findManifestFile(storage);
        const manifest = SolutionManifest.parse(await storage.ReadText(manifestFile));
        // The file stem IS the solution name (the manifest is `<name>.pksln`), so a
        // rename that moved the file is reflected on reopen without rewriting content.
        const session = new Solution(
            SolutionManagerService.solutionNameFromFile(manifestFile),
            storage,
        );
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
            const location = await this.prompts.PickFolder(SolutionManagerService.SaveAsPrompt);
            if (location !== undefined) await this.SaveAs(location);
            return;
        }
        const manifest = new SolutionManifest(
            s.Name,
            s.Members.ToArray().map((m) => m.Ref),
            s.CollectSettings(),
        );
        await storage.WriteText(
            SolutionManagerService.manifestFileName(s.Name),
            manifest.stringify(),
        );
        s.IsDirty = false;
        this.pushRecent(storage.Root);
        this.notifications?.Status(SolutionManagerService.SavedStatus);
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
        await target.WriteText(
            SolutionManagerService.manifestFileName(s.Name),
            manifest.stringify(),
        );
        const reopened = new Solution(s.Name, target);
        for (const m of s.Members) reopened.AddMember(m.Ref.path, m.Ref.type);
        reopened.LoadSettings(s.CollectSettings());
        reopened.IsDirty = false;
        this.setActive(reopened);
        this.pushRecent(location);
    }

    // Set the active solution's name — the engine seam the UI drives (a rename
    // dialog or an in-place tree-view edit). The manifest file name is derived from
    // the name, so when the solution is already saved the on-disk manifest is
    // renamed to match (<old>.pksln -> <new>.pksln); the new name is persisted into
    // the manifest content on the next Save (the rename marks the solution dirty).
    public async Rename(name: string): Promise<void>
    {
        const s = this.ActiveSolution;
        if (s === undefined || name === s.Name) return;
        const storage = s.Storage;
        if (storage !== undefined)
        {
            const from = SolutionManagerService.manifestFileName(s.Name);
            const to = SolutionManagerService.manifestFileName(name);
            if (from !== to && (await storage.Exists(from))) await storage.Rename(from, to);
        }
        s.Name = name;
    }

    public async CloseSolution(): Promise<void>
    {
        if (!(await this.canReplace())) return;
        this.setActive(undefined);
        this.sessionBag.SetValue(SolutionManagerService.LastSolutionName, '');
    }

    private async canReplace(): Promise<boolean>
    {
        const s = this.ActiveSolution;
        if (s === undefined || !s.IsDirty) return true;
        return this.prompts.Ask(
            new ConfirmAsk(
                SolutionManagerService.DiscardMessage,
                SolutionManagerService.DiscardConfirmLabel,
            ),
        );
    }

    // Record a solution's disk root as the most-recent entry (move-to-front, deduped)
    // and remember it as the last-active solution. Routed through the session bag so
    // both changes persist (the SessionStore schedules a debounced save) in one place.
    private pushRecent(location: string): void
    {
        const next = this.recentSolutions.filter((p) => p !== location);
        next.unshift(location);
        this.sessionBag.SetValue(SolutionManagerService.RecentSolutionsName, next);
        this.sessionBag.SetValue(SolutionManagerService.LastSolutionName, location);
    }

    // Replace the recent-solutions list in place and notify. Invoked by the session
    // bag's writable accessor — on restore (stored slice applied) and on pushRecent.
    private setRecent(list: readonly string[]): void
    {
        this.recentSolutions.splice(0, this.recentSolutions.length, ...list);
        this.RaisePropertyChanged(
            SolutionManagerService.RecentSolutionsChangeName,
            undefined,
            this.recentSolutions,
        );
    }

    // The manifest file name for a solution: `<name>.<ext>` (e.g.
    // "Default Solution.pksln"). The user-facing solution name IS the file stem.
    private static manifestFileName(name: string): string
    {
        return `${name}.${SolutionManagerService.ManifestFileExtension}`;
    }

    // Inverse of manifestFileName: the solution name from its manifest file name
    // (the stem, dropping the `.pksln` extension).
    private static solutionNameFromFile(fileName: string): string
    {
        const suffix = `.${SolutionManagerService.ManifestFileExtension}`;
        return fileName.endsWith(suffix) ? fileName.slice(0, -suffix.length) : fileName;
    }

    // Locate the solution manifest in a folder: the single `*.pksln` file (the file
    // name is not fixed — it is derived from the solution name). Throws when the
    // folder holds no manifest, so a missing/renamed solution surfaces to the caller
    // (RestoreSession treats the throw as "the remembered solution is gone").
    private async findManifestFile(storage: IStorage): Promise<string>
    {
        const suffix = `.${SolutionManagerService.ManifestFileExtension}`;
        const entries = await storage.List('');
        const entry = entries.find((e) => !e.IsDirectory && e.Name.endsWith(suffix));
        if (entry === undefined)
        {
            throw new Error(
                `No .${SolutionManagerService.ManifestFileExtension} solution manifest in '${storage.Root}'`,
            );
        }
        return entry.Name;
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
