import {
    type Connection, TextDocuments, TextDocumentSyncKind,
    type InitializeResult, type ServerCapabilities,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { CodeActionParams, CompletionParams, DocumentSymbolParams, FoldingRangeParams,
    HoverParams, DefinitionParams, ReferenceParams, RenameParams, PrepareRenameParams,
    DocumentFormattingParams, SignatureHelpParams, SemanticTokensParams, WorkspaceSymbolParams } from "vscode-languageserver/node.js";
import type { ILanguageService } from "../solution-services/lsp/host/i-language-service.js";
import type { RenameError } from "../solution-services/lsp/analysis/rename-provider.js";
import { SemanticTokensProvider } from "../solution-services/lsp/analysis/semantic-tokens-provider.js";

// A thin, out-of-process JSON-RPC LSP server: a TRANSPORT ADAPTER over the
// `solution-services/lsp` module. It owns no resolver and re-implements no
// analysis — every request delegates 1:1 to the injected ILanguageService, the
// same module an in-process host (Plexus/Monaco) consumes directly. External
// editors that cannot host the module in-process (a VS Code extension, …) drive
// it over this transport instead. (#15)
export class TodlLanguageServer
{
    private readonly documents = new TextDocuments(TextDocument);

    constructor(private readonly service: ILanguageService) {}

    // Advertise exactly the capabilities the ILanguageService backs; sync is Full
    // because the service's DidChange takes the whole buffer text.
    private static Capabilities(): ServerCapabilities
    {
        return {
            textDocumentSync: TextDocumentSyncKind.Full,
            completionProvider: {},
            hoverProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            renameProvider: { prepareProvider: true },
            documentSymbolProvider: true,
            foldingRangeProvider: true,
            workspaceSymbolProvider: true,
            signatureHelpProvider: { triggerCharacters: ["(", ","] },
            codeActionProvider: true,
            documentFormattingProvider: true,
            semanticTokensProvider: { legend: SemanticTokensProvider.Legend, full: true },
        };
    }

    // Wire every LSP handler to the service and begin listening on `connection`.
    public Listen(connection: Connection): void
    {
        connection.onInitialize((): InitializeResult => ({ capabilities: TodlLanguageServer.Capabilities() }));

        // Live-buffer channel + push diagnostics: the service's DidChange ingests the
        // whole text, then diagnostics are pulled and pushed back to the editor.
        this.documents.onDidOpen((e) => this.Sync(connection, e.document));
        this.documents.onDidChangeContent((e) => this.Sync(connection, e.document));

        connection.onCompletion((p: CompletionParams) => this.service.CompletionsAt(p.textDocument.uri, p.position));
        connection.onHover((p: HoverParams) => this.service.HoverAt(p.textDocument.uri, p.position));
        connection.onDefinition((p: DefinitionParams) => this.service.DefinitionAt(p.textDocument.uri, p.position));
        connection.onReferences((p: ReferenceParams) => this.service.ReferencesAt(p.textDocument.uri, p.position, p.context.includeDeclaration));
        connection.onPrepareRename((p: PrepareRenameParams) => this.service.PrepareRename(p.textDocument.uri, p.position));
        connection.onRenameRequest(async (p: RenameParams) =>
        {
            const edits = await this.service.RenameEdits(p.textDocument.uri, p.position, p.newName);
            if (TodlLanguageServer.IsRenameError(edits)) throw new Error(edits.Error);
            return edits;
        });
        connection.onDocumentSymbol((p: DocumentSymbolParams) => this.service.DocumentSymbols(p.textDocument.uri));
        connection.onFoldingRanges((p: FoldingRangeParams) => this.service.FoldingRanges(p.textDocument.uri));
        connection.onWorkspaceSymbol((p: WorkspaceSymbolParams) => this.service.WorkspaceSymbols(p.query));
        connection.onSignatureHelp((p: SignatureHelpParams) => this.service.SignatureHelpAt(p.textDocument.uri, p.position));
        connection.onCodeAction((p: CodeActionParams) => this.service.CodeActions(p.textDocument.uri, p.range, p.context.diagnostics));
        connection.onDocumentFormatting((p: DocumentFormattingParams) => this.service.FormatDocument(p.textDocument.uri));
        connection.languages.semanticTokens.on((p: SemanticTokensParams) => this.service.SemanticTokens(p.textDocument.uri));

        this.documents.listen(connection);
        connection.listen();
    }

    private async Sync(connection: Connection, document: TextDocument): Promise<void>
    {
        this.service.DidChange(document.uri, document.getText());
        const diagnostics = await this.service.DiagnosticsFor(document.uri);
        connection.sendDiagnostics({ uri: document.uri, diagnostics });
    }

    private static IsRenameError(v: unknown): v is RenameError
    {
        return typeof v === "object" && v !== null && typeof (v as RenameError).Error === "string";
    }
}
