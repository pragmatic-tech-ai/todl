import {
    ServiceBase, ServiceKey, Disposable, type IServiceProvider, type IStorage, type IDisposable,
} from "@pragmatic-tech-ai/todl-runtime";
import type { CollectionChange } from "@pragmatic-tech-ai/todl-runtime";
import { TextDocument } from "vscode-languageserver-textdocument";
import type {
    CodeAction, CompletionItem, Diagnostic, DocumentSymbol, FoldingRange, Hover, Location, Position, Range,
    SemanticTokens, SignatureHelp, TextEdit, WorkspaceEdit, WorkspaceSymbol,
} from "vscode-languageserver-types";
import type { SourceFile } from "../../../compiler-services/diagnostics/span.js";
import type { PackageSource } from "../../../domain/domain.js";
import { AnalysisEngine } from "../analysis/analysis-engine.js";
import { AnalyzeKind, type AnalyzeContext, type AnalyzeRequest, type AnalyzeResponse } from "../analysis/protocol.js";
import type { RenameError } from "../analysis/rename-provider.js";
import { AnalysisEngineKey, type IAnalysisEngine } from "./i-analysis-engine.js";
import { ProjectRegistry, PushedSourceProvider, type Project, type OpenDocuments } from "./project-registry.js";
import { SolutionBaseResolver } from "../../solution-manager/engine/solution-base-resolver.js";
import { ResolverPackageSource } from "../../solution-manager/engine/resolver-package-source.js";
import { SolutionSession } from "../../solution-manager/engine/solution-session.js";
import { SolutionManagerService } from "../../solution-manager/engine/solution-manager-service.js";
import type { Solution } from "../../solution-manager/engine/solution.js";
import type { SolutionMember } from "../../solution-manager/engine/solution-member.js";
import {
    ProjectEventsKey, ProjectEventKind, type IProjectEvents, type ProjectEvent,
} from "../../project-services/generators/project-events.js";
import type { ILanguageService } from "./i-language-service.js";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import type { ProjectType, DependencyRef } from "../../package-manager/manifest.js";
import type { WikiOrigin } from "../../project-services/core/wiki-origin.js";

// The live-buffer store: the open documents the editor has pushed via DidChange,
// adapted to the `.all()` surface PushedSourceProvider consumes. A real class (not
// a lambda seam) implementing OpenDocuments so it is handed to SourcesFor directly.
class LiveBufferDocuments implements OpenDocuments
{
    private static readonly LanguageId = "todl";
    private readonly buffers = new Map<string, string>();

    public Set(uri: string, text: string): void
    {
        this.buffers.set(uri, text);
    }

    public all(): TextDocument[]
    {
        const docs: TextDocument[] = [];
        for (const [uri, text] of this.buffers)
        {
            docs.push(TextDocument.create(uri, LiveBufferDocuments.LanguageId, 1, text));
        }
        return docs;
    }
}

// A published-source backstop so the ResolverPackageSource (and thus the
// SolutionSession) can be built even when the host registered no package source.
// Resolving against it is a programming error (nothing is published), so resolve
// throws; versions reports the empty set.
class EmptyPackageSource implements PackageSource
{
    private static readonly NoPackageSourceMessage = "No package source is registered.";

    public resolve(): never
    {
        throw new Error(EmptyPackageSource.NoPackageSourceMessage);
    }

    public versions(): Promise<readonly string[]>
    {
        return Promise.resolve([]);
    }
}

// The keystone host service: the single registered language-service authority. It
// owns the symbol session + resolver + warm base cache, resolves the owning
// project per URI, assembles an AnalyzeContext (sending the warm bases only when
// the project or base-set token changed), and delegates all CPU work to the
// AnalysisEngine behind the IAnalysisEngine seam.
export class SolutionLanguageService extends ServiceBase implements ILanguageService
{
    public static readonly Key = new ServiceKey<SolutionLanguageService>("SolutionLanguageService");

    private static readonly RenameNoProject = "No project owns this document.";
    private static readonly RootSeparator = "/";

    // The manager's INPC property whose change means the whole member set was swapped
    // (a different solution opened) — the signal to re-point the Members subscription.
    private static readonly ActiveSolutionPropertyName = "ActiveSolution";
    // The resolver property mirrored by this service's StaleMembers, and the name this
    // service raises it under.
    private static readonly ResolverStaleMemberIdsPropertyName = "StaleMemberIds";
    private static readonly StaleMembersPropertyName = "StaleMembers";
    // The CollectionChange discriminators this service reacts to. Typed `as const` so a
    // `change.kind === …` comparison still narrows the discriminated union.
    private static readonly InsertedKind = "inserted" as const;
    private static readonly RemovedKind = "removed" as const;

    private readonly engine: IAnalysisEngine;
    private readonly resolver: SolutionBaseResolver;
    private readonly session: SolutionSession;
    private readonly projects = new ProjectRegistry();
    private readonly sources = new PushedSourceProvider();
    private readonly liveDocuments = new LiveBufferDocuments();

    // Permanent lifecycle subscriptions (the manager's ActiveSolution channel + the
    // project-event bus), disposed in dispose().
    private readonly subscriptions: IDisposable[] = [];
    // The ONE rewirable subscription: the active solution's Members collection. It is
    // re-pointed whenever ActiveSolution changes (a different solution swaps the
    // collection out), so it lives in its own slot rather than the permanent list.
    private membersSubscription: IDisposable | undefined;
    // Set true the instant dispose() runs so an in-flight async maintenance task (or a
    // bus event whose source has no unsubscribe) becomes an inert no-op.
    private disposed = false;
    // The serialized tail of fire-and-forget maintenance kicked off from the sync
    // Members listener. WhenIdle awaits it so a test observes the eviction/token bump
    // deterministically; failures are swallowed so one bad task can't wedge the chain.
    private pending: Promise<void> = Promise.resolve();

    // Monotonic base-set version, bumped on every targeted invalidation so the
    // context-assembly gating re-sends the affected project's warm bases on its next
    // request (see ContextFor).
    private baseSetToken = 0;

    // The context-assembly bookkeeping: the project the last request targeted, and
    // the token last sent to the engine per project. Bases are re-sent whenever the
    // project changed or the token moved since this project last received them.
    private lastProject: Project | null = null;
    private readonly sentTokenByProject = new Map<string, number>();

    // The warm-cache build kicked off at construction; every feature awaits it so a
    // request never races the eager resolution.
    private readonly warmup: Promise<void>;

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this.engine = provider.get(AnalysisEngineKey) ?? new AnalysisEngine();
        this.resolver = provider.get(SolutionBaseResolver.Key) ?? new SolutionBaseResolver(provider);
        const packages = provider.get(SolutionManagerService.PackageSourceKey) ?? new EmptyPackageSource();
        this.session = new SolutionSession(new ResolverPackageSource(this.resolver, packages));
        this.warmup = this.BuildWarmCache();
        this.SubscribeToLifecycle();
        this.SubscribeToResolverStale();
    }

    // The member ids evicted by the most recent invalidation (the resolver's
    // StaleMemberIds, re-raised as this service's own StaleMembers change).
    public get StaleMembers(): ReadonlySet<string>
    {
        return this.resolver.StaleMemberIds;
    }

    public ResolveBasesFor(consumerStorage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[]; originOf: ReadonlyMap<string, WikiOrigin> }>
    {
        return this.resolver.ResolveBasesFor(consumerStorage);
    }

    public ReferencedPublishedRefs(consumerStorage: IStorage): Promise<Set<string>>
    {
        return this.resolver.ReferencedPublishedRefs(consumerStorage);
    }

    public WorkspaceProducers(kind: ProjectType): Promise<readonly DependencyRef[]>
    {
        return this.resolver.WorkspaceProducers(kind);
    }

    public ProducedIdOf(consumerStorage: IStorage): Promise<string | undefined>
    {
        return this.resolver.ProducedIdOf(consumerStorage);
    }

    public get BaseSetToken(): number
    {
        return this.baseSetToken;
    }

    // The composition session, held over the live-first resolver (Task-3 wiring).
    // Wave-1 keeps it for the headless composition path; the editor features read
    // the warm per-project base cache directly.
    public get Session(): SolutionSession
    {
        return this.session;
    }

    public DidChange(uri: string, text: string): void
    {
        this.liveDocuments.Set(uri, text);
    }

    public async CompletionsAt(uri: string, pos: Position): Promise<CompletionItem[]>
    {
        const project = await this.ProjectFor(uri);
        if (project === null) return [];
        const response = await this.Dispatch(project, { Kind: AnalyzeKind.Completion, Uri: uri, Position: pos });
        return response.Kind === AnalyzeKind.Completion ? response.Items : [];
    }

    public async HoverAt(uri: string, pos: Position): Promise<Hover | null>
    {
        const project = await this.ProjectFor(uri);
        if (project === null) return null;
        const response = await this.Dispatch(project, { Kind: AnalyzeKind.Hover, Uri: uri, Position: pos });
        return response.Kind === AnalyzeKind.Hover ? response.Hover : null;
    }

    public async DefinitionAt(uri: string, pos: Position): Promise<Location | null>
    {
        const project = await this.ProjectFor(uri);
        if (project === null) return null;
        const response = await this.Dispatch(project, { Kind: AnalyzeKind.Definition, Uri: uri, Position: pos });
        return response.Kind === AnalyzeKind.Definition ? response.Location : null;
    }

    public async ReferencesAt(uri: string, pos: Position, includeDecl: boolean): Promise<Location[]>
    {
        const project = await this.ProjectFor(uri);
        if (project === null) return [];
        const response = await this.Dispatch(project, { Kind: AnalyzeKind.References, Uri: uri, Position: pos, IncludeDeclaration: includeDecl });
        return response.Kind === AnalyzeKind.References ? response.Locations : [];
    }

    public async PrepareRename(uri: string, pos: Position): Promise<Range | null>
    {
        const project = await this.ProjectFor(uri);
        if (project === null) return null;
        const response = await this.Dispatch(project, { Kind: AnalyzeKind.PrepareRename, Uri: uri, Position: pos });
        return response.Kind === AnalyzeKind.PrepareRename ? response.Range : null;
    }

    public async RenameEdits(uri: string, pos: Position, newName: string): Promise<WorkspaceEdit | RenameError>
    {
        const project = await this.ProjectFor(uri);
        if (project === null) return { Error: SolutionLanguageService.RenameNoProject };
        const response = await this.Dispatch(project, { Kind: AnalyzeKind.Rename, Uri: uri, Position: pos, NewName: newName });
        return response.Kind === AnalyzeKind.Rename ? response.Result : { Error: SolutionLanguageService.RenameNoProject };
    }

    public async DocumentSymbols(uri: string): Promise<DocumentSymbol[]>
    {
        const project = await this.ProjectFor(uri);
        if (project === null) return [];
        const response = await this.Dispatch(project, { Kind: AnalyzeKind.DocumentSymbols, Uri: uri });
        return response.Kind === AnalyzeKind.DocumentSymbols ? response.Symbols : [];
    }

    public async FoldingRanges(uri: string): Promise<FoldingRange[]>
    {
        const project = await this.ProjectFor(uri);
        if (project === null) return [];
        const response = await this.Dispatch(project, { Kind: AnalyzeKind.Folding, Uri: uri });
        return response.Kind === AnalyzeKind.Folding ? response.Ranges : [];
    }

    // Workspace symbols span the whole workspace, so there is no owning URI: query
    // every registered project and concatenate. Each project is gated independently
    // by the same base-set rule.
    public async WorkspaceSymbols(query: string): Promise<WorkspaceSymbol[]>
    {
        await this.warmup;
        const out: WorkspaceSymbol[] = [];
        for (const project of this.projects.All())
        {
            const response = await this.Dispatch(project, { Kind: AnalyzeKind.WorkspaceSymbols, Uri: project.RootUri, Query: query });
            if (response.Kind === AnalyzeKind.WorkspaceSymbols) out.push(...response.Symbols);
        }
        return out;
    }

    public async SemanticTokens(uri: string): Promise<SemanticTokens>
    {
        const project = await this.ProjectFor(uri);
        if (project === null) return { data: [] };
        const response = await this.Dispatch(project, { Kind: AnalyzeKind.SemanticTokens, Uri: uri });
        return response.Kind === AnalyzeKind.SemanticTokens ? response.Tokens : { data: [] };
    }

    public async SignatureHelpAt(uri: string, pos: Position): Promise<SignatureHelp | null>
    {
        const project = await this.ProjectFor(uri);
        if (project === null) return null;
        const response = await this.Dispatch(project, { Kind: AnalyzeKind.SignatureHelp, Uri: uri, Position: pos });
        return response.Kind === AnalyzeKind.SignatureHelp ? response.Help : null;
    }

    public async CodeActions(uri: string, range: Range, diagnostics: readonly Diagnostic[]): Promise<CodeAction[]>
    {
        const project = await this.ProjectFor(uri);
        if (project === null) return [];
        const response = await this.Dispatch(project, { Kind: AnalyzeKind.CodeActions, Uri: uri, Range: range, Diagnostics: diagnostics });
        return response.Kind === AnalyzeKind.CodeActions ? response.Actions : [];
    }

    public async FormatDocument(uri: string): Promise<TextEdit[]>
    {
        const project = await this.ProjectFor(uri);
        if (project === null) return [];
        const response = await this.Dispatch(project, { Kind: AnalyzeKind.Formatting, Uri: uri });
        return response.Kind === AnalyzeKind.Formatting ? response.Edits : [];
    }

    public async DiagnosticsFor(uri: string): Promise<Diagnostic[]>
    {
        const project = await this.ProjectFor(uri);
        if (project === null) return [];
        const response = await this.Dispatch(project, { Kind: AnalyzeKind.Diagnostics, Uri: uri });
        if (response.Kind !== AnalyzeKind.Diagnostics) return [];
        return [...(response.DiagnosticsByUri.get(uri) ?? [])];
    }

    public override dispose(): void
    {
        // Flip the guard first so any task already queued (or a bus event with no
        // unsubscribe handle) short-circuits, then tear down every subscription.
        this.disposed = true;
        this.membersSubscription?.dispose();
        this.membersSubscription = undefined;
        for (const sub of this.subscriptions) sub.dispose();
        this.subscriptions.length = 0;
        super.dispose();
    }

    // Test seam: await the serialized tail of fire-and-forget maintenance so an
    // assertion that follows a Members mutation sees its eviction / token bump.
    public async WhenIdle(): Promise<void>
    {
        await this.pending;
    }

    // Re-raise the resolver's StaleMemberIds change as this service's own StaleMembers.
    private SubscribeToResolverStale(): void
    {
        const signal = this.resolver.PropertyChanged(SolutionLanguageService.ResolverStaleMemberIdsPropertyName);
        this.subscriptions.push(signal.subscribe((e) =>
            this.RaisePropertyChanged(SolutionLanguageService.StaleMembersPropertyName, e.oldValue, e.newValue)));
    }

    // Wire the solution lifecycle → targeted cache maintenance. Two permanent arms —
    // the manager's ActiveSolution channel (re-point the Members subscription on a
    // solution switch) and the project-event bus (reference changes) — plus the
    // rewirable Members subscription itself. Guarded for a headless run (no manager /
    // no bus) and for a lightweight test double whose manager lacks PropertyChanged.
    private SubscribeToLifecycle(): void
    {
        const manager = this.Provider.get(SolutionManagerService.Key);
        if (manager !== undefined)
        {
            const propertyChanged = (manager as unknown as { PropertyChanged?: (name: string) => { subscribe: (handler: () => void) => IDisposable } }).PropertyChanged;
            const sub = propertyChanged?.call(manager, SolutionLanguageService.ActiveSolutionPropertyName).subscribe(() => this.RewireMembers(manager.ActiveSolution));
            if (sub !== undefined) this.subscriptions.push(sub);
            this.RewireMembers(manager.ActiveSolution);
        }
        const events = this.Provider.get(ProjectEventsKey);
        if (events !== undefined) this.SubscribeToProjectEvents(events);
    }

    // (Re)point the Members subscription at the active solution's collection, tearing
    // down the previous one — a solution switch swaps the collection out from under us.
    private RewireMembers(solution: Solution | undefined): void
    {
        this.membersSubscription?.dispose();
        this.membersSubscription = undefined;
        if (solution === undefined) return;
        const off = solution.Members.Subscribe((change) => this.OnMembersChanged(change));
        this.membersSubscription = new Disposable(off);
    }

    // A member added/removed: enqueue targeted maintenance per touched member. Insert
    // refreshes the new member's warm bases; remove drops its slice. Other change kinds
    // (moved/replaced/cleared/reset) don't alter any member's own base closure.
    private OnMembersChanged(change: CollectionChange<SolutionMember>): void
    {
        if (this.disposed) return;
        if (change.kind === SolutionLanguageService.RemovedKind)
        {
            for (const member of change.items) this.Enqueue(() => this.MaintainMember(member, false));
        }
        else if (change.kind === SolutionLanguageService.InsertedKind)
        {
            for (const member of change.items) this.Enqueue(() => this.MaintainMember(member, true));
        }
    }

    // Subscribe to the project-event bus and react to ReferencesChanged. Subscribe
    // returns an IDisposable that truly detaches the handler, stored for dispose() to
    // tear down (the disposed guard in the handler is belt-and-suspenders).
    private SubscribeToProjectEvents(events: IProjectEvents): void
    {
        this.subscriptions.push(events.Subscribe((event) => this.OnProjectEvent(event)));
    }

    private async OnProjectEvent(event: ProjectEvent): Promise<void>
    {
        if (this.disposed) return;
        if (event.Kind !== ProjectEventKind.ReferencesChanged) return;
        await this.InvalidateMember(event.Project, true);
    }

    // Serialize fire-and-forget maintenance onto one tail so WhenIdle can await it; a
    // failed task is swallowed so it can't wedge the chain for the next event.
    private Enqueue(work: () => Promise<void>): void
    {
        this.pending = this.pending.then(work).catch(() => undefined);
    }

    private async MaintainMember(member: SolutionMember, refresh: boolean): Promise<void>
    {
        const storage = member.Storage;
        if (storage === undefined) return;
        await this.InvalidateMember(storage, refresh);
    }

    // The single maintenance step every lifecycle event funnels through: map the
    // storage to its member id, evict that member + its transitive dependents, bring
    // every evicted member's warm bases back in line with the NEW compiled graph, and
    // bump the token so the next request for each touched project re-sends its bases.
    private async InvalidateMember(storage: IStorage, refresh: boolean): Promise<void>
    {
        if (this.disposed) return;
        const id = await this.resolver.ConsumerIdOf(storage);
        if (id === undefined) return;
        this.resolver.Invalidate(id);
        await this.RefreshStaleMembers(storage, id, refresh);
        this.BumpToken();
    }

    // Invalidate evicts the changed member PLUS its transitive dependents and surfaces
    // that set as resolver.StaleMemberIds. Every evicted member's warm bases are now
    // stale: a still-live member is re-resolved so its re-sent bases reflect the edited
    // member's NEW compiled document (not the copy captured when it was last warmed),
    // and a member that no longer exists (a removal) has its registry entry dropped.
    // Without refreshing the DEPENDENTS, the token bump would re-send their stale bases.
    private async RefreshStaleMembers(changed: IStorage, changedId: string, refresh: boolean): Promise<void>
    {
        const liveById = await this.LiveMembersById();
        for (const staleId of this.resolver.StaleMemberIds)
        {
            const liveStorage = liveById.get(staleId);
            if (liveStorage !== undefined) await this.RefreshWarmBases(liveStorage);
            else if (!refresh && staleId === changedId) this.projects.Remove(SolutionLanguageService.RootUriOf(changed));
        }
    }

    // The active solution's members keyed by their resolver consumer id, so a stale id
    // the resolver reports can be mapped back to the live storage to re-resolve. A
    // removed member is absent from this map (it left the collection before maintenance
    // ran), which is exactly how RefreshStaleMembers tells "refresh" from "drop".
    private async LiveMembersById(): Promise<Map<string, IStorage>>
    {
        const byId = new Map<string, IStorage>();
        const solution = this.Provider.get(SolutionManagerService.Key)?.ActiveSolution;
        if (solution === undefined) return byId;
        for (const member of solution.Members)
        {
            const memberStorage = member.Storage;
            if (memberStorage === undefined) continue;
            const memberId = await this.resolver.ConsumerIdOf(memberStorage);
            if (memberId !== undefined) byId.set(memberId, memberStorage);
        }
        return byId;
    }

    // Monotonic increment — a change to any member's base closure invalidates every
    // consumer's cached copy keyed by the old token.
    private BumpToken(): void
    {
        this.baseSetToken += 1;
    }

    // Resolve the owning project for a URI once the warm cache is ready; null when
    // the URI falls under no project root (the caller returns the empty/null result).
    private async ProjectFor(uri: string): Promise<Project | null>
    {
        await this.warmup;
        return this.projects.ProjectFor(uri);
    }

    // Assemble the context and run the engine. The request carries only the fields a
    // kind needs (exactOptionalPropertyTypes — optionals are omitted, never undefined).
    private async Dispatch(project: Project, request: Omit<AnalyzeRequest, "Context">): Promise<AnalyzeResponse>
    {
        return this.engine.Analyze({ ...request, Context: this.ContextFor(project) });
    }

    // Build the AnalyzeContext for a project. Documents are the live pushed buffers
    // under the project root. Bases ride along only when this project is newly active
    // or its base-set token has moved since it last received them; otherwise the
    // engine reuses its token-keyed cached copy (the warm path).
    private ContextFor(project: Project): AnalyzeContext
    {
        const documents: readonly SourceFile[] = this.sources.SourcesFor(project, this.liveDocuments);
        const include = project !== this.lastProject || this.sentTokenByProject.get(project.RootUri) !== this.baseSetToken;
        this.lastProject = project;
        if (include)
        {
            this.sentTokenByProject.set(project.RootUri, this.baseSetToken);
            return { BaseSetToken: this.baseSetToken, Bases: project.Bases, Documents: documents };
        }
        return { BaseSetToken: this.baseSetToken, Documents: documents };
    }

    // Eagerly resolve each open member's warm base-set into the registry, keyed by
    // the member's rooted storage URI, so the first editor request already hits a
    // warm cache instead of paying resolution latency inline.
    private async BuildWarmCache(): Promise<void>
    {
        const solution = this.Provider.get(SolutionManagerService.Key)?.ActiveSolution;
        if (solution === undefined) return;
        for (const member of solution.Members)
        {
            const storage = member.Storage;
            if (storage === undefined) continue;
            await this.RefreshWarmBases(storage);
        }
    }

    // Re-resolve a member's warm base-set and store it under its project root — the
    // per-member body shared between the construction-time build and a live refresh.
    private async RefreshWarmBases(storage: IStorage): Promise<void>
    {
        const rootUri = SolutionLanguageService.RootUriOf(storage);
        const { bases } = await this.resolver.ResolveBasesFor(storage);
        this.projects.Register(rootUri);
        this.projects.SetBases(rootUri, bases);
    }

    // The project-root URI for a member's storage: its root normalized to a trailing
    // separator so longest-prefix matching (ProjectFor / PushedSourceProvider) is
    // exact at the folder boundary.
    private static RootUriOf(storage: IStorage): string
    {
        const root = storage.Root;
        return root.endsWith(SolutionLanguageService.RootSeparator) ? root : root + SolutionLanguageService.RootSeparator;
    }
}
