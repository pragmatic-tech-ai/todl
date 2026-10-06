import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createConnection } from "vscode-languageserver/node.js";
import { StreamMessageReader, StreamMessageWriter, createMessageConnection } from "vscode-jsonrpc/node.js";
import type { Hover, Location, CompletionItem, WorkspaceEdit } from "vscode-languageserver-types";
import { Signal } from "@pragmatic-tech-ai/todl-runtime";
import { TodlLanguageServer } from "../todl-language-server.js";
import type { ILanguageService } from "../../solution-services/lsp/host/i-language-service.js";
import type { RenameError } from "../../solution-services/lsp/analysis/rename-provider.js";
import type { SolutionGraphChange } from "../../solution-services/lsp/host/solution-graph.js";
import type { ResolvedResource } from "../../solution-services/lsp/host/resource-locator.js";

// A fake language service recording the calls the proxy delegates, with canned results.
class FakeService implements ILanguageService
{
    public calls: string[] = [];
    public lastDidChange: { uri: string; text: string } | undefined;
    async CompletionsAt(uri: string): Promise<CompletionItem[]> { this.calls.push(`completion:${uri}`); return [{ label: "Component" }]; }
    async HoverAt(uri: string): Promise<Hover | null> { this.calls.push(`hover:${uri}`); return { contents: "a concept" }; }
    async DefinitionAt(): Promise<Location | null> { return null; }
    async ReferencesAt(): Promise<Location[]> { return []; }
    async PrepareRename(): Promise<null> { return null; }
    async RenameEdits(): Promise<WorkspaceEdit | RenameError> { return { changes: {} }; }
    async DocumentSymbols(): Promise<[]> { return []; }
    async FoldingRanges(): Promise<[]> { return []; }
    async WorkspaceSymbols(): Promise<[]> { return []; }
    async SemanticTokens(): Promise<{ data: number[] }> { return { data: [] }; }
    async SignatureHelpAt(): Promise<null> { return null; }
    async CodeActions(): Promise<[]> { return []; }
    async FormatDocument(): Promise<[]> { return []; }
    DidChange(uri: string, text: string): void { this.lastDidChange = { uri, text }; }
    async DiagnosticsFor(): Promise<[]> { return []; }
    async ResolveBasesFor(): Promise<{ bases: never[]; problems: never[]; originOf: Map<string, never> }> { return { bases: [], problems: [], originOf: new Map<string, never>() }; }
    async ReferencedPublishedRefs(): Promise<Set<string>> { return new Set(); }
    async WorkspaceProducers(): Promise<[]> { return []; }
    async ProducedIdOf(): Promise<undefined> { return undefined; }
    get StaleMembers(): ReadonlySet<string> { return new Set(); }
    async ModelView(): Promise<undefined> { return undefined; }
    Resources(): ResolvedResource[] { return []; }
    readonly GraphChanged = new Signal<SolutionGraphChange>();
}

function wire(service: ILanguageService)
{
    const c2s = new PassThrough();
    const s2c = new PassThrough();
    const serverConn = createConnection(new StreamMessageReader(c2s), new StreamMessageWriter(s2c));
    new TodlLanguageServer(service).Listen(serverConn);
    const client = createMessageConnection(new StreamMessageReader(s2c), new StreamMessageWriter(c2s));
    client.listen();
    return client;
}

test("initialize advertises the capabilities the service backs (#15)", async () => {
    const client = wire(new FakeService());
    const result = await client.sendRequest("initialize", { processId: null, rootUri: null, capabilities: {} });
    const caps = (result as { capabilities: Record<string, unknown> }).capabilities;
    assert.ok(caps.hoverProvider);
    assert.ok(caps.completionProvider);
    assert.ok(caps.renameProvider);
    assert.ok(caps.semanticTokensProvider);
});

test("hover and completion requests proxy 1:1 to the service (#15)", async () => {
    const service = new FakeService();
    const client = wire(service);
    await client.sendRequest("initialize", { processId: null, rootUri: null, capabilities: {} });

    const hover = await client.sendRequest("textDocument/hover", { textDocument: { uri: "m.todl" }, position: { line: 0, character: 0 } });
    assert.deepEqual((hover as Hover).contents, "a concept");

    const items = await client.sendRequest("textDocument/completion", { textDocument: { uri: "m.todl" }, position: { line: 0, character: 0 } });
    assert.equal((items as CompletionItem[])[0]?.label, "Component");

    assert.ok(service.calls.includes("hover:m.todl"));
    assert.ok(service.calls.includes("completion:m.todl"));
});
