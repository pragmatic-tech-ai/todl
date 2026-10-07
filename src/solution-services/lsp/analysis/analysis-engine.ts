import type { Position, Range } from "vscode-languageserver-types";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import type { IAnalysisEngine } from "../host/i-analysis-engine.js";
import { AnalysisSnapshot } from "./analysis-snapshot.js";
import { AnalyzeKind, type AnalyzeContext, type AnalyzeRequest, type AnalyzeResponse } from "./protocol.js";
import { NavigationProvider } from "./navigation-provider.js";
import { HoverProvider } from "./hover-provider.js";
import { CompletionProvider } from "./completion-provider.js";
import { RenameProvider } from "./rename-provider.js";
import { DocumentSymbolProvider } from "./document-symbol-provider.js";
import { FoldingProvider } from "./folding-provider.js";
import { WorkspaceSymbolProvider } from "./workspace-symbol-provider.js";
import { SemanticTokensProvider } from "./semantic-tokens-provider.js";
import { SignatureHelpProvider } from "./signature-help-provider.js";
import { CodeActionProvider } from "./code-action-provider.js";
import { FormattingProvider } from "./formatting-provider.js";

// A typed staleness signal: the engine throws this when a request carries no Bases
// and its token does not match the cached base-set. A caller detects it via the
// stable Code discriminant / StaleBaseSetError.Is — never by matching message text.
export class StaleBaseSetError extends Error
{
    public static readonly Code = "StaleBaseSet";
    private static readonly Detail = "base-set token does not match the cached base-set; re-send Bases.";

    constructor()
    {
        super(`${StaleBaseSetError.Code}: ${StaleBaseSetError.Detail}`);
        this.name = StaleBaseSetError.Code;
    }

    public static Is(error: unknown): error is StaleBaseSetError
    {
        return error instanceof StaleBaseSetError;
    }
}

// Single dispatcher for all analysis requests. Caches the last base-set by token
// so plain keystroke requests need not re-send it.
export class AnalysisEngine implements IAnalysisEngine
{
    private static readonly MissingPosition = "Request requires a Position.";
    private static readonly MissingRange = "Request requires a Range.";
    private static readonly MissingNewName = "Rename request requires a NewName.";
    private static readonly EmptyQuery = "";

    private readonly navigation = new NavigationProvider();
    private readonly hover = new HoverProvider();
    private readonly completion = new CompletionProvider();
    private readonly rename = new RenameProvider();
    private readonly documentSymbols = new DocumentSymbolProvider();
    private readonly folding = new FoldingProvider();
    private readonly workspaceSymbols = new WorkspaceSymbolProvider();
    private readonly semanticTokens = new SemanticTokensProvider();
    private readonly signatureHelp = new SignatureHelpProvider();
    private readonly codeActions = new CodeActionProvider();
    private readonly formatting = new FormattingProvider();

    private cachedToken: number | null = null;
    private cachedBases: readonly TodlDocument[] = [];

    public async Analyze(request: AnalyzeRequest): Promise<AnalyzeResponse>
    {
        const a = this.SnapshotFor(request);
        const uri = request.Uri;
        switch (request.Kind)
        {
            case AnalyzeKind.Completion:
                return { Kind: request.Kind, Items: this.completion.CompletionsAt(a, uri, AnalysisEngine.RequirePosition(request)) };
            case AnalyzeKind.Hover:
                return { Kind: request.Kind, Hover: this.hover.HoverAt(a, uri, AnalysisEngine.RequirePosition(request)) };
            case AnalyzeKind.Definition:
                return { Kind: request.Kind, Location: this.navigation.DefinitionAt(a, uri, AnalysisEngine.RequirePosition(request)) };
            case AnalyzeKind.References:
                return { Kind: request.Kind, Locations: this.navigation.ReferencesAt(a, uri, AnalysisEngine.RequirePosition(request), request.IncludeDeclaration ?? false) };
            case AnalyzeKind.PrepareRename:
                return { Kind: request.Kind, Range: this.rename.PrepareRename(a, uri, AnalysisEngine.RequirePosition(request)) };
            case AnalyzeKind.Rename:
                return { Kind: request.Kind, Result: this.rename.RenameEdits(a, uri, AnalysisEngine.RequirePosition(request), AnalysisEngine.RequireNewName(request)) };
            case AnalyzeKind.DocumentSymbols:
                return { Kind: request.Kind, Symbols: this.documentSymbols.Of(a, uri) };
            case AnalyzeKind.Folding:
                return { Kind: request.Kind, Ranges: this.folding.Of(a, uri) };
            case AnalyzeKind.WorkspaceSymbols:
                return { Kind: request.Kind, Symbols: this.workspaceSymbols.Query(a, request.Query ?? AnalysisEngine.EmptyQuery) };
            case AnalyzeKind.SemanticTokens:
                return { Kind: request.Kind, Tokens: this.semanticTokens.Of(a, uri) };
            case AnalyzeKind.SignatureHelp:
                return { Kind: request.Kind, Help: this.signatureHelp.SignatureHelpAt(a, uri, AnalysisEngine.RequirePosition(request)) };
            case AnalyzeKind.CodeActions:
                return { Kind: request.Kind, Actions: this.codeActions.CodeActions(a, uri, AnalysisEngine.RequireRange(request), [...(request.Diagnostics ?? [])]) };
            case AnalyzeKind.Formatting:
                return { Kind: request.Kind, Edits: this.formatting.FormatDocument(a, uri) };
            case AnalyzeKind.Diagnostics:
                return { Kind: request.Kind, Diagnostics: a.Diagnostics, DiagnosticsByUri: a.DiagnosticsByUri };
        }
    }

    // Prefer the shared SolutionGraph slice when the host attached one (the warm
    // path: the model was already compiled incrementally). Fall back to the
    // per-request `checkAgainst` compile otherwise — defensive during rollout and for
    // a project the shared graph does not represent.
    private SnapshotFor(request: AnalyzeRequest): AnalysisSnapshot
    {
        const slice = request.Context.Graph;
        if (slice !== undefined)
        {
            // Keep the base-set cache warm even on the graph path, so a later Build
            // fallback (graph went unhealthy) still has the bases it needs. The graph
            // supplies the model directly, so a stale token never throws here.
            this.TryCacheBases(request.Context);
            return AnalysisSnapshot.FromGraph(request.Context.Documents, slice);
        }
        const bases = this.ResolveBases(request);
        return AnalysisSnapshot.Build(request.Context.Documents, bases);
    }

    private ResolveBases(request: AnalyzeRequest): readonly TodlDocument[]
    {
        const ctx = request.Context;
        if (ctx.Bases !== undefined)
        {
            // Out-of-order safety (Wave 2): never let an OLDER base-set overwrite the
            // cache — a late request carrying a stale token would otherwise answer a
            // newer request from a regressed base-set. Still serve this request from
            // its own carried bases, but leave the newer cached copy in place.
            if (!this.TryCacheBases(ctx)) return ctx.Bases;
            return this.cachedBases;
        }
        if (this.cachedToken === null || ctx.BaseSetToken !== this.cachedToken)
        {
            throw new StaleBaseSetError();
        }
        return this.cachedBases;
    }

    // Update the token-keyed base-set cache from a context that carries Bases, unless the
    // carried token is OLDER than the one already cached (an out-of-order late request).
    // Returns true when the cache now reflects this request's bases, false when the
    // carried bases are stale and must not displace the newer cached copy.
    private TryCacheBases(ctx: AnalyzeContext): boolean
    {
        if (ctx.Bases === undefined) return false;
        if (ctx.BaseSetToken < (this.cachedToken ?? Number.NEGATIVE_INFINITY)) return false;
        this.cachedBases = ctx.Bases;
        this.cachedToken = ctx.BaseSetToken;
        return true;
    }

    private static RequirePosition(request: AnalyzeRequest): Position
    {
        if (request.Position === undefined) throw new Error(AnalysisEngine.MissingPosition);
        return request.Position;
    }

    private static RequireRange(request: AnalyzeRequest): Range
    {
        if (request.Range === undefined) throw new Error(AnalysisEngine.MissingRange);
        return request.Range;
    }

    private static RequireNewName(request: AnalyzeRequest): string
    {
        if (request.NewName === undefined) throw new Error(AnalysisEngine.MissingNewName);
        return request.NewName;
    }
}
