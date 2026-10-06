import type {
    CodeAction, CompletionItem, Diagnostic, DocumentSymbol, FoldingRange, Hover, Location, Position, Range,
    SemanticTokens, SignatureHelp, TextEdit, WorkspaceEdit, WorkspaceSymbol,
} from "vscode-languageserver-types";
import type { IStorage, Signal } from "@pragmatic-tech-ai/todl-runtime";
import type { RenameError } from "../analysis/rename-provider.js";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import type { ProjectType, DependencyRef } from "../../package-manager/manifest.js";
import type { WikiOrigin } from "../../project-services/core/wiki-origin.js";
import type { Repository } from "../../../compiler-services/model/model.js";
import type { SolutionGraphChange } from "./solution-graph.js";
import type { ResolvedResource } from "./resource-locator.js";

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

    // Base-resolution facade: thin delegation to the solution's live-first base resolver,
    // so a host never resolves the resolver itself. Signatures mirror the resolver 1:1.
    ResolveBasesFor(consumerStorage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[]; originOf: ReadonlyMap<string, WikiOrigin> }>;
    ReferencedPublishedRefs(consumerStorage: IStorage): Promise<Set<string>>;
    WorkspaceProducers(kind: ProjectType): Promise<readonly DependencyRef[]>;
    ProducedIdOf(consumerStorage: IStorage): Promise<string | undefined>;
    // Member ids evicted by the most recent invalidation; raises PropertyChanged("StaleMembers").
    readonly StaleMembers: ReadonlySet<string>;

    // The shared solution-graph read seam (Phase 1): ONE Repository + origin map for the
    // whole active solution (the SAME graph for every consumer; undefined when no solution
    // is active or the storage is not a member), the resources a node declares, and a
    // signal that fires with the affected member ids when a member's slice is replaced.
    ModelView(consumerStorage: IStorage): Promise<{ model: Repository; originOf: ReadonlyMap<string, WikiOrigin> } | undefined>;
    Resources(nodeId: string): ResolvedResource[];
    readonly GraphChanged: Signal<SolutionGraphChange>;
}
