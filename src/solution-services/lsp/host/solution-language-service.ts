import {
    ServiceBase, ServiceKey, type IServiceProvider, type IStorage, type IDisposable,
} from "@pragmatic-tech-ai/todl-runtime";
import type { TextDocuments } from "vscode-languageserver";
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
import { ProjectRegistry, PushedSourceProvider, type Project } from "./project-registry.js";
import { SolutionBaseResolver } from "../../solution-manager/engine/solution-base-resolver.js";
import { ResolverPackageSource } from "../../solution-manager/engine/resolver-package-source.js";
import { SolutionSession } from "../../solution-manager/engine/solution-session.js";
import { SolutionManagerService } from "../../solution-manager/engine/solution-manager-service.js";
import type { ILanguageService } from "./i-language-service.js";

// The live-buffer store: the open documents the editor has pushed via DidChange,
// adapted to the `.all()` surface PushedSourceProvider consumes. A real class (not
// a lambda seam) so it can be handed to SourcesFor as a TextDocuments stand-in.
class LiveBufferDocuments
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

// The keystone host service: the single registered language-service authority. It
// owns the symbol session + resolver + warm base cache, resolves the owning
// project per URI, assembles an AnalyzeContext (sending the warm bases only when
// the project or base-set token changed), and delegates all CPU work to the
// AnalysisEngine behind the IAnalysisEngine seam.
export class SolutionLanguageService extends ServiceBase implements ILanguageService
{
    public static readonly Key = new ServiceKey<SolutionLanguageService>("SolutionLanguageService");

    private static readonly RenameNoProject = "No project owns this document.";
    private static readonly NoPackageSourceMessage = "No package source is registered.";
    private static readonly RootSeparator = "/";

    // A published-source backstop so the ResolverPackageSource (and thus the
    // SolutionSession) can be built even when the host registered no package source.
    private static readonly EmptyPackageSource: PackageSource =
    {
        resolve(): never { throw new Error(SolutionLanguageService.NoPackageSourceMessage); },
        versions(): Promise<readonly string[]> { return Promise.resolve([]); },
    };

    private readonly engine: IAnalysisEngine;
    private readonly resolver: SolutionBaseResolver;
    private readonly session: SolutionSession;
    private readonly projects = new ProjectRegistry();
    private readonly sources = new PushedSourceProvider();
    private readonly liveDocuments = new LiveBufferDocuments();

    // Teardown slots; the member/stale subscriptions that fill these land in T13.
    private readonly subscriptions: IDisposable[] = [];

    // Monotonic base-set version. T13 bumps it on a base change; here it is only
    // initialized + exposed, and drives the context-assembly gating below.
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
        const packages = provider.get(SolutionManagerService.PackageSourceKey) ?? SolutionLanguageService.EmptyPackageSource;
        this.session = new SolutionSession(new ResolverPackageSource(this.resolver, packages));
        this.warmup = this.BuildWarmCache();
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
        for (const sub of this.subscriptions) sub.dispose();
        this.subscriptions.length = 0;
        super.dispose();
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
        const documents: readonly SourceFile[] = this.sources.SourcesFor(project, this.liveDocuments as unknown as TextDocuments<TextDocument>);
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
            const rootUri = SolutionLanguageService.RootUriOf(storage);
            const { bases } = await this.resolver.ResolveBasesFor(storage);
            this.projects.Register(rootUri);
            this.projects.SetBases(rootUri, bases);
        }
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
