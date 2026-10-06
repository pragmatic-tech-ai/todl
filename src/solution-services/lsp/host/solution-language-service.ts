import {
    ServiceBase, ServiceKey, Disposable, FakeStorage, isWatchableStorage,
    type IServiceProvider, type IStorage, type IDisposable, type Signal,
} from "@pragmatic-tech-ai/todl-runtime";
import { MemberContentWatcher } from "./member-content-watcher.js";
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
import type { IBaseResolver } from "../../solution-manager/engine/i-base-resolver.js";
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
import { ProjectType, parseManifest, type DependencyRef, type ProjectManifest } from "../../package-manager/manifest.js";
import type { WikiOrigin } from "../../project-services/core/wiki-origin.js";
import { SolutionGraph, type SolutionGraphMember, type SolutionGraphChange } from "./solution-graph.js";
import { ResourceLocator, type ResolvedResource } from "./resource-locator.js";
import { TodlProjectSourceFiles } from "../../project-services/core/todl-sources.js";
import { PackageStoreKey } from "../../todl-build-system/package-store.js";
import { PackageKind } from "../../../publish/publish.js";
import { PROJECT_MANIFEST_FILENAME } from "../../project-services/core/project-factory.js";
import type { Repository } from "../../../compiler-services/model/model.js";

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
export class SolutionLanguageService extends ServiceBase implements ILanguageService, IBaseResolver
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
    // The source-file predicate the live-buffer overlay mirrors so a live buffer is
    // admitted only where the on-disk collect would admit the file: a `.todl` whose
    // top-level folder is neither the always-excluded build output nor (for a producer)
    // the samples folder.
    private static readonly TodlExtension = ".todl";
    private static readonly BuildOutputDir = "dist";
    private static readonly SamplesDir = "samples";

    private readonly engine: IAnalysisEngine;
    private readonly resolver: SolutionBaseResolver;
    private readonly session: SolutionSession;
    private readonly projects = new ProjectRegistry();
    private readonly sources = new PushedSourceProvider();
    private readonly liveDocuments = new LiveBufferDocuments();

    // The single shared solution graph (Phase 1 read seam): ONE Repository for the
    // whole active solution, assembled in warmup and kept in step by a targeted
    // ReplaceMember on each live edit and a rebuild on each lifecycle/on-disk event.
    private readonly solutionGraph = new SolutionGraph();
    // The packages-storage backstop handed to a ResourceLocator when no PackageStore
    // is registered (a headless / test host). A local member's resources resolve to
    // its own OpenProject storage, so this is consulted only for published origins.
    private readonly emptyPackages: IStorage = new FakeStorage();
    // Per-member-root generation counter coalescing live-edit replaces: DidChange bumps
    // the root's generation and captures it; the dequeued replace runs only if it is
    // still the latest (an older keystroke superseded by a newer one is skipped).
    private readonly replaceGeneration = new Map<string, number>();
    // False until the first RewireMembers (the construction-time call) has run, so that
    // initial wiring leaves the graph build to the warmup promise (which Ready awaits);
    // every SUBSEQUENT RewireMembers (a solution switch) enqueues its own rebuild.
    private graphBootstrapped = false;
    // The message of the most recent graph build failure (duplicate member id, cycle),
    // else undefined — a readable flag that the shared graph is stale.
    private lastGraphBuildError: string | undefined;

    // Permanent lifecycle subscriptions (the manager's ActiveSolution channel + the
    // project-event bus), disposed in dispose().
    private readonly subscriptions: IDisposable[] = [];
    // The ONE rewirable subscription: the active solution's Members collection. It is
    // re-pointed whenever ActiveSolution changes (a different solution swaps the
    // collection out), so it lives in its own slot rather than the permanent list.
    private membersSubscription: IDisposable | undefined;
    // One on-disk content watcher per member (keyed by its storage), so a `.todl`
    // added/removed under a member refreshes that member's warm bases — the gap
    // left when only Members changes and ReferencesChanged drove invalidation (#16).
    private readonly contentWatchers = new Map<IStorage, MemberContentWatcher>();
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

    public ConsumerIdOf(consumerStorage: IStorage): Promise<string | undefined>
    {
        return this.resolver.ConsumerIdOf(consumerStorage);
    }

    public Invalidate(memberId: string): void
    {
        this.resolver.Invalidate(memberId);
    }

    public get BaseSetToken(): number
    {
        return this.baseSetToken;
    }

    // The message of the most recent shared-graph build failure (duplicate member id,
    // dependency cycle), or undefined when the last build succeeded. A readable flag so
    // a consumer can tell the graph is stale rather than silently up to date.
    public get LastGraphBuildError(): string | undefined
    {
        return this.lastGraphBuildError;
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
        // The resolver base-cache is deliberately NOT invalidated on a keystroke (an edit
        // does not change the base closure); only the shared graph's owning slice is
        // re-loaded, debounced onto the same pending tail WhenIdle/Flush await. Bump the
        // owning member's generation and capture it so a burst of keystrokes coalesces —
        // only the latest enqueued replace for that member actually runs (see below).
        const root = this.MemberRootForUri(uri);
        if (root === undefined) return;
        const generation = (this.replaceGeneration.get(root) ?? 0) + 1;
        this.replaceGeneration.set(root, generation);
        this.Enqueue(() => this.ReplaceOwningMember(uri, root, generation));
    }

    // The shared graph's Changed signal, re-exposed: it fires with the affected member
    // ids whenever a member's slice is replaced (the same Signal instance across every
    // Build/ReplaceMember, so a subscriber attached once keeps receiving).
    public get GraphChanged(): Signal<SolutionGraphChange>
    {
        return this.solutionGraph.Changed;
    }

    // The shared solution view for a member: the ONE Repository + origin map the whole
    // solution composes into. Awaits warmup; undefined when no solution is active or the
    // storage is not one of its members (every valid member shares the identical graph).
    public async ModelView(consumerStorage: IStorage): Promise<{ model: Repository; originOf: ReadonlyMap<string, WikiOrigin> } | undefined>
    {
        await this.warmup;
        const solution = this.Provider.get(SolutionManagerService.Key)?.ActiveSolution;
        if (solution === undefined) return undefined;
        let isMember = false;
        for (const member of solution.Members) if (member.Storage === consumerStorage) isMember = true;
        if (!isMember) return undefined;
        return { model: this.solutionGraph.Model, originOf: this.solutionGraph.OriginOf };
    }

    // The resources a node declares (icon / MuralResource annotations carrying a path),
    // resolved to a concrete storage via the shared graph's origin map. A local member's
    // resource lands on its own storage; a published one on the packages backend.
    public Resources(nodeId: string): ResolvedResource[]
    {
        return new ResourceLocator(this.solutionGraph.Model, this.solutionGraph.OriginOf, this.PackagesStorage()).Resources(nodeId);
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
        for (const watcher of this.contentWatchers.values()) watcher.dispose();
        this.contentWatchers.clear();
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

    // Test seam: the warmup promise every feature awaits, so a caller can await the
    // eager graph build before reading ModelView / Resources.
    public Ready(): Promise<void>
    {
        return this.warmup;
    }

    // Test seam: the serialized maintenance tail (alias of WhenIdle), awaited so an
    // enqueued ReplaceMember from DidChange is applied before asserting.
    public Flush(): Promise<void>
    {
        return this.pending;
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
        // A solution switch swaps the whole member set out — tear down the old
        // content watchers and start one per member of the new solution.
        for (const watcher of this.contentWatchers.values()) watcher.dispose();
        this.contentWatchers.clear();
        if (solution !== undefined)
        {
            const off = solution.Members.Subscribe((change) => this.OnMembersChanged(change));
            this.membersSubscription = new Disposable(off);
            for (const member of solution.Members) this.WatchMemberContent(member);
        }
        // Re-assemble the shared graph for the (possibly swapped or cleared) member set —
        // a solution switch raises no per-member Inserted events, so nothing else would.
        // The first (construction-time) call leaves the initial build to the warmup
        // promise that Ready awaits; every later switch enqueues its own rebuild.
        if (this.graphBootstrapped) this.Enqueue(() => this.RebuildGraphSafely());
        this.graphBootstrapped = true;
    }

    // Start (or tear down) the on-disk content watcher for one member. A `.todl`
    // file added/removed anywhere under the member routes through the existing
    // InvalidateMember path, exactly like a ReferencesChanged event. (#16)
    private WatchMemberContent(member: SolutionMember): void
    {
        const storage = member.Storage;
        if (storage === undefined || !isWatchableStorage(storage) || this.contentWatchers.has(storage)) return;
        const watcher = new MemberContentWatcher(storage, () => this.Enqueue(() => this.InvalidateMember(storage, true)));
        this.contentWatchers.set(storage, watcher);
        this.Enqueue(() => watcher.Start());
    }

    private UnwatchMemberContent(member: SolutionMember): void
    {
        const storage = member.Storage;
        if (storage === undefined) return;
        this.contentWatchers.get(storage)?.dispose();
        this.contentWatchers.delete(storage);
    }

    // A member added/removed: enqueue targeted maintenance per touched member. Insert
    // refreshes the new member's warm bases; remove drops its slice. Other change kinds
    // (moved/replaced/cleared/reset) don't alter any member's own base closure.
    private OnMembersChanged(change: CollectionChange<SolutionMember>): void
    {
        if (this.disposed) return;
        if (change.kind === SolutionLanguageService.RemovedKind)
        {
            for (const member of change.items)
            {
                this.UnwatchMemberContent(member);
                this.Enqueue(() => this.MaintainMember(member, false));
            }
        }
        else if (change.kind === SolutionLanguageService.InsertedKind)
        {
            for (const member of change.items)
            {
                this.WatchMemberContent(member);
                this.Enqueue(() => this.MaintainMember(member, true));
            }
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
        // Await warmup so an early lifecycle event cannot race (and lose to) the warmup
        // graph build with a stale assembly.
        await this.warmup;
        try
        {
            const id = await this.resolver.ConsumerIdOf(storage);
            if (id === undefined) return;
            this.resolver.Invalidate(id);
            await this.RefreshStaleMembers(storage, id, refresh);
            this.BumpToken();
        }
        finally
        {
            // Keep the shared graph in step with the NEW member set / closure, even on the
            // early-return path (a removed member whose manifest is gone must still drop out
            // of the graph). A structural / reference change can alter topology, so the
            // simplest correct Phase-1 move is a full rebuild from the current members (the
            // fast incremental ReplaceMember is reserved for live keystroke edits, which
            // cannot change the base closure).
            await this.RebuildGraphSafely();
        }
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
        if (solution !== undefined)
        {
            for (const member of solution.Members)
            {
                const storage = member.Storage;
                if (storage === undefined) continue;
                await this.RefreshWarmBases(storage);
            }
        }
        // Always build the graph — even with no active solution, AssembleMembers yields []
        // and Build([]) leaves (clears) the graph, so Ready/ModelView have a defined state.
        await this.RebuildGraphSafely();
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

    // Rebuild the whole shared graph from the active solution's current members. Used at
    // warmup and after any lifecycle / on-disk / reference change routed through
    // InvalidateMember. The graph is an ADDITIVE read seam, so a build failure is
    // swallowed rather than allowed to break the resolver / editor-feature path.
    private async RebuildGraphSafely(): Promise<void>
    {
        if (this.disposed) return;
        try
        {
            await this.solutionGraph.Build(await this.AssembleMembers());
            this.lastGraphBuildError = undefined;
        }
        catch (error)
        {
            // A build failure (duplicate member id / dependency cycle) must not regress the
            // editor-feature path — the shared graph keeps its last good state; record the
            // error so a consumer can tell the graph is stale (see LastGraphBuildError).
            this.lastGraphBuildError = error instanceof Error ? error.message : String(error);
        }
    }

    // Assemble one SolutionGraphMember per solution member: its graph id, storage,
    // live-overlaid .todl sources, the OTHER local member ids it depends on (baseIds),
    // and the published base documents it depends on (publishedBases). A dependency is
    // LOCAL when some open member produces its id (→ baseIds, so its nodes get an origin
    // on their source member storage); otherwise it resolves as a published package
    // through the resolver (→ publishedBases). Only metaModels / libraries bindings are
    // classified — an architecture binding is never a producer, so it is not a base here.
    private async AssembleMembers(): Promise<SolutionGraphMember[]>
    {
        const solution = this.Provider.get(SolutionManagerService.Key)?.ActiveSolution;
        if (solution === undefined) return [];
        const entries: { storage: IStorage; manifest: ProjectManifest }[] = [];
        for (const member of solution.Members)
        {
            const storage = member.Storage;
            if (storage === undefined) continue;
            const manifest = await this.ReadManifest(storage);
            if (manifest !== undefined) entries.push({ storage, manifest });
        }
        const localProducers = new Set<string>();
        for (const entry of entries)
        {
            if (SolutionLanguageService.IsProducerType(entry.manifest.type) && entry.manifest.id !== undefined) localProducers.add(entry.manifest.id);
        }
        const members: SolutionGraphMember[] = [];
        for (const entry of entries)
        {
            const id = SolutionLanguageService.MemberIdOf(entry.manifest);
            const sources = await this.SourcesForMember(entry.storage, entry.manifest.type);
            const baseIds = new Set<string>();
            const publishedBases: TodlDocument[] = [];
            for (const dep of SolutionLanguageService.DepsOf(entry.manifest))
            {
                if (localProducers.has(dep.ref.id))
                {
                    if (dep.ref.id !== id) baseIds.add(dep.ref.id);
                }
                else
                {
                    const sourced = await this.resolver.TryGet({ kind: dep.kind, id: dep.ref.id, version: dep.ref.version });
                    if (sourced !== undefined) publishedBases.push(sourced.Document);
                }
            }
            members.push({ id, storage: entry.storage, sources, baseIds: [...baseIds], publishedBases });
        }
        return members;
    }

    // A member's own .todl sources as full-URI SourceFiles, overlaid with any live editor
    // buffer under the member root (the live buffer wins). A producer excludes its
    // samples/ folder, mirroring the per-member compile's source classification.
    private async SourcesForMember(storage: IStorage, type: ProjectType): Promise<SourceFile[]>
    {
        const root = SolutionLanguageService.RootUriOf(storage);
        const onDisk = SolutionLanguageService.IsProducerType(type)
            ? await TodlProjectSourceFiles.CollectTaxonomy(storage)
            : await TodlProjectSourceFiles.Collect(storage);
        const byUri = new Map<string, string>();
        for (const file of onDisk) byUri.set(root + file.uri, file.text);
        for (const doc of this.liveDocuments.all())
        {
            if (!doc.uri.startsWith(root)) continue;
            // Admit a live buffer only where the disk collect would admit the file, so an
            // open samples/** or non-.todl buffer does not leak into the member's compile.
            if (!SolutionLanguageService.IncludesLivePath(doc.uri.slice(root.length), type)) continue;
            byUri.set(doc.uri, doc.getText());
        }
        return [...byUri].map(([uri, text]) => ({ uri, text }));
    }

    // Mirror of TodlProjectSourceFiles' collect predicate for a member-relative path: a
    // `.todl` whose top-level folder is neither the build-output folder nor (for a
    // producer) the samples folder. Nested folders of those names are not special.
    private static IncludesLivePath(relPath: string, type: ProjectType): boolean
    {
        if (!relPath.toLowerCase().endsWith(SolutionLanguageService.TodlExtension)) return false;
        const slash = relPath.indexOf(SolutionLanguageService.RootSeparator);
        const topDir = slash >= 0 ? relPath.slice(0, slash) : "";
        if (topDir === SolutionLanguageService.BuildOutputDir) return false;
        if (topDir === SolutionLanguageService.SamplesDir && SolutionLanguageService.IsProducerType(type)) return false;
        return true;
    }

    // The live-edit path: re-load just the member that owns the changed URI from its
    // current (live-overlaid) sources, so the shared graph reflects the keystroke and
    // GraphChanged fires. Awaits warmup so the graph exists; a member not yet built (or
    // removed concurrently) is a no-op rather than a throw.
    private async ReplaceOwningMember(uri: string, root: string, generation: number): Promise<void>
    {
        if (this.disposed) return;
        await this.warmup;
        // Latest-wins: a newer keystroke for the same member has already bumped the
        // generation, so this superseded replace skips its re-read + reload.
        if (this.replaceGeneration.get(root) !== generation) return;
        const owner = await this.MemberForUri(uri);
        if (owner === undefined) return;
        const id = SolutionLanguageService.MemberIdOf(owner.manifest);
        if (!this.solutionGraph.Has(id)) return;
        try
        {
            this.solutionGraph.ReplaceMember(id, await this.SourcesForMember(owner.storage, owner.manifest.type));
        }
        catch
        {
            // ignore: a replace race (e.g. the member was removed concurrently) is non-fatal
        }
    }

    // The longest member root that is a prefix of `uri` (no manifest read — a synchronous
    // sibling of MemberForUri used to key live-edit coalescing); undefined when no member
    // owns the URI.
    private MemberRootForUri(uri: string): string | undefined
    {
        const solution = this.Provider.get(SolutionManagerService.Key)?.ActiveSolution;
        if (solution === undefined) return undefined;
        let best: string | undefined;
        let bestLength = -1;
        for (const member of solution.Members)
        {
            const storage = member.Storage;
            if (storage === undefined) continue;
            const root = SolutionLanguageService.RootUriOf(storage);
            if (uri.startsWith(root) && root.length > bestLength)
            {
                best = root;
                bestLength = root.length;
            }
        }
        return best;
    }

    // The solution member whose root is the longest prefix of `uri`, with its parsed
    // manifest; undefined when no member owns the URI (mirrors ProjectRegistry.ProjectFor).
    private async MemberForUri(uri: string): Promise<{ storage: IStorage; manifest: ProjectManifest } | undefined>
    {
        const solution = this.Provider.get(SolutionManagerService.Key)?.ActiveSolution;
        if (solution === undefined) return undefined;
        let best: { storage: IStorage; manifest: ProjectManifest } | undefined;
        let bestLength = -1;
        for (const member of solution.Members)
        {
            const storage = member.Storage;
            if (storage === undefined) continue;
            const root = SolutionLanguageService.RootUriOf(storage);
            if (!uri.startsWith(root) || root.length <= bestLength) continue;
            const manifest = await this.ReadManifest(storage);
            if (manifest === undefined) continue;
            best = { storage, manifest };
            bestLength = root.length;
        }
        return best;
    }

    private async ReadManifest(storage: IStorage): Promise<ProjectManifest | undefined>
    {
        try { return parseManifest(await storage.ReadText(PROJECT_MANIFEST_FILENAME)); }
        catch { return undefined; }
    }

    // The packages-storage backend a ResourceLocator reads published-origin resources
    // from: the registered PackageStore's storage, else the empty backstop.
    private PackagesStorage(): IStorage
    {
        return this.Provider.get(PackageStoreKey)?.Storage ?? this.emptyPackages;
    }

    // The id a member carries in the shared graph: its package id, else (an architecture,
    // which has no id) its name — identical to the resolver's ConsumerIdOf.
    private static MemberIdOf(manifest: ProjectManifest): string
    {
        return manifest.id ?? manifest.name;
    }

    // A producer kind (meta-model / library) owns a published base; an architecture does
    // not. Drives both the local-producer classification and the samples/ source exclusion.
    private static IsProducerType(type: ProjectType): boolean
    {
        return type === ProjectType.MetaModel || type === ProjectType.Library;
    }

    // A member's base dependencies tagged with the package kind each was declared under
    // (metaModels → MetaModel, libraries → Library) — the same classification the
    // resolver's baseIdsOf graph uses, so local-vs-published matches the compile path.
    private static DepsOf(manifest: ProjectManifest): { ref: DependencyRef; kind: PackageKind }[]
    {
        const deps: { ref: DependencyRef; kind: PackageKind }[] = [];
        for (const ref of manifest.metaModels ?? []) deps.push({ ref, kind: PackageKind.MetaModel });
        for (const ref of manifest.libraries ?? []) deps.push({ ref, kind: PackageKind.Library });
        return deps;
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
