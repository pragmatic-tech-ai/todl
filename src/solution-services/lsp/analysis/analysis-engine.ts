import type { Position, Range } from "vscode-languageserver-types";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import type { IAnalysisEngine } from "../host/i-analysis-engine.js";
import { AnalysisSnapshot } from "./analysis-snapshot.js";
import { AnalyzeKind, type AnalyzeRequest, type AnalyzeResponse } from "./protocol.js";
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

// Single dispatcher for all analysis requests. Caches the last base-set by token
// so plain keystroke requests need not re-send it.
export class AnalysisEngine implements IAnalysisEngine
{
    private static readonly StaleBaseSet = "StaleBaseSet";
    private static readonly StaleBaseSetDetail = ": base-set token does not match the cached base-set; re-send Bases.";
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
        const bases = this.ResolveBases(request);
        const a = AnalysisSnapshot.Build(request.Context.Documents, bases);
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

    private ResolveBases(request: AnalyzeRequest): readonly TodlDocument[]
    {
        const ctx = request.Context;
        if (ctx.Bases !== undefined)
        {
            this.cachedBases = ctx.Bases;
            this.cachedToken = ctx.BaseSetToken;
            return this.cachedBases;
        }
        if (this.cachedToken === null || ctx.BaseSetToken !== this.cachedToken)
        {
            throw new Error(AnalysisEngine.StaleBaseSet + AnalysisEngine.StaleBaseSetDetail);
        }
        return this.cachedBases;
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
