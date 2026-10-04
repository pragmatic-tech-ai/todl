import type {
    CodeAction, CompletionItem, Diagnostic, DocumentSymbol, FoldingRange, Hover, Location, Position, Range,
    SemanticTokens, SignatureHelp, TextEdit, WorkspaceEdit, WorkspaceSymbol,
} from "vscode-languageserver-types";
import type { RenameError } from "../analysis/rename-provider.js";

// The single host-facing language-service authority: one promise-returning method
// per editor feature plus the live-buffer channel (DidChange) and pull-model
// diagnostics (DiagnosticsFor). Every feature is scoped to the project that owns
// the URI; a URI under no project root yields that feature's empty/null result.
export interface ILanguageService
{
    CompletionsAt(uri: string, pos: Position): Promise<CompletionItem[]>;
    HoverAt(uri: string, pos: Position): Promise<Hover | null>;
    DefinitionAt(uri: string, pos: Position): Promise<Location | null>;
    ReferencesAt(uri: string, pos: Position, includeDecl: boolean): Promise<Location[]>;
    PrepareRename(uri: string, pos: Position): Promise<Range | null>;
    RenameEdits(uri: string, pos: Position, newName: string): Promise<WorkspaceEdit | RenameError>;
    DocumentSymbols(uri: string): Promise<DocumentSymbol[]>;
    FoldingRanges(uri: string): Promise<FoldingRange[]>;
    WorkspaceSymbols(query: string): Promise<WorkspaceSymbol[]>;
    SemanticTokens(uri: string): Promise<SemanticTokens>;
    SignatureHelpAt(uri: string, pos: Position): Promise<SignatureHelp | null>;
    CodeActions(uri: string, range: Range, diagnostics: readonly Diagnostic[]): Promise<CodeAction[]>;
    FormatDocument(uri: string): Promise<TextEdit[]>;
    DidChange(uri: string, text: string): void;
    DiagnosticsFor(uri: string): Promise<Diagnostic[]>;
}
