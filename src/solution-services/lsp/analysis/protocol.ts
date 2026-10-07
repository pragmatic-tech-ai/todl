import type {
    CodeAction, CompletionItem, Diagnostic, DocumentSymbol, FoldingRange, Hover, Location, Position, Range,
    SemanticTokens, SignatureHelp, TextEdit, WorkspaceEdit, WorkspaceSymbol,
} from "vscode-languageserver-types";
import type { SourceFile } from "../../../compiler-services/diagnostics/span.js";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import type { RenameError } from "./rename-provider.js";
import type { GraphSlice } from "./graph-slice.js";

export enum AnalyzeKind
{
    Completion,
    Hover,
    Definition,
    References,
    PrepareRename,
    Rename,
    DocumentSymbols,
    Folding,
    WorkspaceSymbols,
    SemanticTokens,
    SignatureHelp,
    CodeActions,
    Formatting,
    Diagnostics,
}

// Bases are sent only when the base-set changed; otherwise the engine reuses its
// cached copy provided BaseSetToken still matches. `Graph`, when present, carries the
// shared SolutionGraph's per-project slice: the engine then builds the snapshot from
// it (reusing the already-compiled model) instead of a fresh per-request compile.
export interface AnalyzeContext
{
    BaseSetToken: number;
    Bases?: readonly TodlDocument[];
    Documents: readonly SourceFile[];
    Graph?: GraphSlice;
}

export interface AnalyzeRequest
{
    Kind: AnalyzeKind;
    Uri: string;
    Position?: Position;
    Range?: Range;
    Diagnostics?: readonly Diagnostic[];
    NewName?: string;
    Query?: string;
    IncludeDeclaration?: boolean;
    Context: AnalyzeContext;
}

export type AnalyzeResponse =
    | { Kind: AnalyzeKind.Completion; Items: CompletionItem[] }
    | { Kind: AnalyzeKind.Hover; Hover: Hover | null }
    | { Kind: AnalyzeKind.Definition; Location: Location | null }
    | { Kind: AnalyzeKind.References; Locations: Location[] }
    | { Kind: AnalyzeKind.PrepareRename; Range: Range | null }
    | { Kind: AnalyzeKind.Rename; Result: WorkspaceEdit | RenameError }
    | { Kind: AnalyzeKind.DocumentSymbols; Symbols: DocumentSymbol[] }
    | { Kind: AnalyzeKind.Folding; Ranges: FoldingRange[] }
    | { Kind: AnalyzeKind.WorkspaceSymbols; Symbols: WorkspaceSymbol[] }
    | { Kind: AnalyzeKind.SemanticTokens; Tokens: SemanticTokens }
    | { Kind: AnalyzeKind.SignatureHelp; Help: SignatureHelp | null }
    | { Kind: AnalyzeKind.CodeActions; Actions: CodeAction[] }
    | { Kind: AnalyzeKind.Formatting; Edits: TextEdit[] }
    | { Kind: AnalyzeKind.Diagnostics; Diagnostics: readonly Diagnostic[]; DiagnosticsByUri: ReadonlyMap<string, readonly Diagnostic[]> };
