import { type IServiceProvider, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionManagerService } from './solution-manager-service.js'
import { type SolutionMember } from './solution-member.js'
import { type IProjectFactoryRegistry, type IStorageProviderRegistry } from './host-services.js'
import { ProjectEventsKey, ProjectEventKind } from '../../project-services/generators/project-events.js'
import { PROJECT_MANIFEST_FILENAME } from '../../project-services/core/project-factory.js'
import { type ProjectBaseModelBindings } from '../../project-services/core/base-binding.js'
import { parseManifest, type ProjectType } from '../../package-manager/manifest.js'

// What a caller supplies to create a project: its type, name, the parent folder it
// is created inside (the project lives in its own `<location>/<name>` subfolder),
// and the base models it binds.
export type CreateProjectSpec =
{
    type: ProjectType
    name: string
    location: string
    bindings: ProjectBaseModelBindings
}

export enum CreateError
{
    FolderHasManifest,
    NoFactory,
    Invalid,
    Unresolved,
}

// Structurally the plexus-core CreateOutcome contract (created + folder, or a
// typed failure) minus UX text.
export type CreateOutcome =
    | { created: true; member: SolutionMember; folder: string; name: string; type: ProjectType }
    | { created: false; error: CreateError }

export enum OpenError
{
    AlreadyOpen,
    NoFactory,
    Failed,
}

export type OpenOutcome =
    | { opened: true; member: SolutionMember; folder: string }
    | { opened: false; error: OpenError }

// A project-level recents entry, handed to the host's recents list.
export interface ProjectRecentEntry
{
    name: string
    path: string
    type: string
    openedAt: number
}

// Seam: the host's recent-projects list (project-level recents live in the host).
export interface IProjectRecents
{
    Add(entry: ProjectRecentEntry): Promise<void>
}

// Seam: the host's persisted set of open project folders (the session).
export interface IProjectSessionStore
{
    List(): Promise<readonly string[]>
    Add(folder: string): Promise<void>
    Remove(folder: string): Promise<void>
}

// Seam: the host's veto over closing a project (e.g. unsaved documents).
export interface ICloseGuard
{
    CanClose(member: SolutionMember): Promise<boolean>
}

// UX-free project lifecycle: create / open / close / restore as typed outcomes,
// layered over SolutionManagerService.OpenProject / CloseProject, raising the
// ProjectEvents bus (when one is registered) at each real lifecycle moment.
export class ProjectLifecycle
{
    constructor(
        private readonly provider: IServiceProvider,
        private readonly manager: SolutionManagerService,
        private readonly session?: IProjectSessionStore,
        private readonly recents?: IProjectRecents)
    {
    }

    public async CreateProject(spec: CreateProjectSpec): Promise<CreateOutcome>
    {
        const name = spec.name.trim()
        if (name === '' || /[\\/]/.test(name) || name === '.' || name === '..')
        {
            return { created: false, error: CreateError.Invalid }
        }
        const factory = this.Factories().factoryFor(spec.type)
        if (factory === undefined) return { created: false, error: CreateError.NoFactory }

        const folder = ProjectLifecycle.Join(spec.location, name)
        const storage = this.Storages().CreateStorage(folder)
        if (await storage.Exists(PROJECT_MANIFEST_FILENAME))
        {
            return { created: false, error: CreateError.FolderHasManifest }
        }

        try
        {
            // Writes don't mkdir parents, so create the project's own subfolder first.
            await this.Storages().CreateStorage(spec.location).CreateDirectory(name)
            const hasBindings = (spec.bindings.metaModels?.length ?? 0) > 0
                || (spec.bindings.libraries?.length ?? 0) > 0
                || (spec.bindings.architectures?.length ?? 0) > 0
            await factory.createProject(storage, name, hasBindings ? spec.bindings : undefined)
            const member = await this.manager.OpenProject(folder)
            // The member opened but its project did not resolve (load failure or a
            // registry change) - not necessarily a missing factory.
            if (!member.IsResolved) return { created: false, error: CreateError.Unresolved }
            await this.Track(member, folder, name, spec.type)
            // Created is raised by the project factory's own createProject (it does
            // not dedupe downstream), so the lifecycle must not raise it again.
            return { created: true, member, folder, name, type: spec.type }
        }
        catch
        {
            // Any failure after the folder was made leaves that half-made folder
            // behind; it is not cleaned up (storage has no delete).
            return { created: false, error: CreateError.Invalid }
        }
    }

    public async OpenProjectAt(folder: string): Promise<OpenOutcome>
    {
        if (this.FindOpen(folder) !== undefined) return { opened: false, error: OpenError.AlreadyOpen }
        try
        {
            const member = await this.manager.OpenProject(folder)
            if (!member.IsResolved) return { opened: false, error: OpenError.NoFactory }
            const name = (member.Project as { Name?: string } | undefined)?.Name ?? member.Ref.path
            await this.Track(member, folder, name, member.Ref.type)
            if (member.Storage !== undefined) await this.Raise(ProjectEventKind.Opened, member.Storage)
            return { opened: true, member, folder }
        }
        catch
        {
            return { opened: false, error: OpenError.Failed }
        }
    }

    // False (project stays open) when the guard vetoes; true once closed.
    public async CloseProject(member: SolutionMember, guard?: ICloseGuard): Promise<boolean>
    {
        if (guard !== undefined && !(await guard.CanClose(member))) return false
        const storage = member.Storage
        const key = ProjectLifecycle.SessionKey(member, member.Ref.path)
        await this.manager.CloseProject(member)
        await this.session?.Remove(key)
        if (storage !== undefined) await this.Raise(ProjectEventKind.MemberRemoved, storage)
        return true
    }

    // Reopen the previous session's projects; prune folders whose manifest is gone.
    public async RestoreSession(): Promise<void>
    {
        if (this.session === undefined) return
        for (const folder of await this.session.List())
        {
            let hasManifest = false
            try
            {
                hasManifest = await this.Storages().CreateStorage(folder).Exists(PROJECT_MANIFEST_FILENAME)
            }
            catch
            {
                hasManifest = false
            }
            if (hasManifest)
            {
                // One corrupt project must not abort restoring the rest.
                try
                {
                    const member = await this.manager.OpenProject(folder)
                    if (member.Storage !== undefined) await this.Raise(ProjectEventKind.Opened, member.Storage)
                }
                catch
                {
                    continue
                }
            }
            else
            {
                await this.session.Remove(folder)
            }
        }
    }

    private FindOpen(folder: string): SolutionMember | undefined
    {
        const solution = this.manager.ActiveSolution
        if (solution === undefined) return undefined
        const target = ProjectLifecycle.Normalize(folder)
        return solution.Members.ToArray().find((m) =>
            m.Storage !== undefined && ProjectLifecycle.Normalize(m.Storage.Root) === target)
    }

    private async Track(member: SolutionMember, folder: string, name: string, type: string): Promise<void>
    {
        await this.recents?.Add({ name, path: folder, type, openedAt: Date.now() })
        await this.session?.Add(ProjectLifecycle.SessionKey(member, folder))
    }

    // The one normalized key a project is stored under in the session, used by both
    // Track and CloseProject so a slash variant cannot leave a stale entry.
    private static SessionKey(member: SolutionMember, fallback: string): string
    {
        return ProjectLifecycle.Normalize(member.Storage?.Root ?? fallback)
    }

    // Announce a lifecycle moment on the ProjectEvents bus; no bus => nothing raised.
    // The manifest is read as written on disk. A failing subscriber must not fail the
    // lifecycle step that already succeeded, so its error is swallowed.
    private async Raise(kind: ProjectEventKind, storage: IStorage): Promise<void>
    {
        const events = this.provider.get(ProjectEventsKey)
        if (events === undefined) return
        try
        {
            const manifest = parseManifest(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
            await events.Raise({ Kind: kind, ProjectType: manifest.type, Project: storage, Manifest: manifest })
        }
        catch
        {
            // see above
        }
    }

    private Factories(): IProjectFactoryRegistry
    {
        return this.provider.getRequired(SolutionManagerService.ProjectFactoryRegistryKey)
    }

    private Storages(): IStorageProviderRegistry
    {
        return this.provider.getRequired(SolutionManagerService.StorageRegistryKey)
    }

    private static Normalize(p: string): string
    {
        return p.replace(/\\/g, '/').replace(/\/+$/, '')
    }

    private static Join(base: string, rel: string): string
    {
        return `${ProjectLifecycle.Normalize(base)}/${rel}`
    }
}
