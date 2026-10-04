import { test } from "node:test";
import assert from "node:assert/strict";
import type { Position, Range } from "vscode-languageserver-types";
import { AnalysisEngine } from "../analysis-engine.js";
import { AnalyzeKind, type AnalyzeContext, type AnalyzeRequest } from "../protocol.js";
import type { SourceFile } from "../../../../compiler-services/diagnostics/span.js";
import { preludeDocument } from "../../../../compiler-services/stdlib/prelude.js";

class Fixtures
{
    public static readonly Uri = "d.todl";
    public static readonly Documents: SourceFile[] = [{ uri: Fixtures.Uri, text: [
        "namespace demo {",
        "  primitive string { }",
        "  concept animal { name : string; }",
        "  concept dog : animal { }",
        "}",
    ].join("\n") }];
    public static readonly Pos: Position = { line: 3, character: 17 };
    public static readonly Rng: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };

    public static Request(kind: AnalyzeKind, context: AnalyzeContext): AnalyzeRequest
    {
        return {
            Kind: kind, Uri: Fixtures.Uri, Position: Fixtures.Pos, Range: Fixtures.Rng,
            Diagnostics: [], NewName: "hound", Query: "dog", IncludeDeclaration: true, Context: context,
        };
    }
}

test("each AnalyzeKind routes to the matching provider and tags the response", async () =>
{
    const engine = new AnalysisEngine();
    const ctx: AnalyzeContext = { BaseSetToken: 1, Bases: [], Documents: Fixtures.Documents };
    for (const kind of [
        AnalyzeKind.Completion, AnalyzeKind.Hover, AnalyzeKind.Definition, AnalyzeKind.References,
        AnalyzeKind.PrepareRename, AnalyzeKind.Rename, AnalyzeKind.DocumentSymbols, AnalyzeKind.Folding,
        AnalyzeKind.WorkspaceSymbols, AnalyzeKind.SemanticTokens, AnalyzeKind.SignatureHelp,
        AnalyzeKind.CodeActions, AnalyzeKind.Formatting, AnalyzeKind.Diagnostics,
    ])
    {
        const r = await engine.Analyze(Fixtures.Request(kind, ctx));
        assert.equal(r.Kind, kind);
    }
    const completion = await engine.Analyze(Fixtures.Request(AnalyzeKind.Completion, ctx));
    assert.equal(completion.Kind, AnalyzeKind.Completion);
    if (completion.Kind === AnalyzeKind.Completion) assert.ok(Array.isArray(completion.Items));
    const symbols = await engine.Analyze(Fixtures.Request(AnalyzeKind.WorkspaceSymbols, ctx));
    if (symbols.Kind === AnalyzeKind.WorkspaceSymbols) assert.ok(symbols.Symbols.some(s => s.name === "dog"));
    const diags = await engine.Analyze(Fixtures.Request(AnalyzeKind.Diagnostics, ctx));
    if (diags.Kind === AnalyzeKind.Diagnostics) assert.ok(Array.isArray(diags.Diagnostics));
});

test("base-set token suppresses re-sending unchanged bases", async () =>
{
    const engine = new AnalysisEngine();
    const bases = [preludeDocument()];
    await engine.Analyze(Fixtures.Request(AnalyzeKind.Diagnostics, { BaseSetToken: 7, Bases: bases, Documents: Fixtures.Documents }));
    const r = await engine.Analyze(Fixtures.Request(AnalyzeKind.Diagnostics, { BaseSetToken: 7, Documents: Fixtures.Documents }));
    assert.equal(r.Kind, AnalyzeKind.Diagnostics);
});

test("a stale token without bases is rejected so the host re-sends", async () =>
{
    const engine = new AnalysisEngine();
    await engine.Analyze(Fixtures.Request(AnalyzeKind.Diagnostics, { BaseSetToken: 7, Bases: [preludeDocument()], Documents: Fixtures.Documents }));
    await assert.rejects(() => engine.Analyze(Fixtures.Request(AnalyzeKind.Diagnostics, { BaseSetToken: 8, Documents: Fixtures.Documents })), /StaleBaseSet/);
});

test("a first request with no bases and no cache is rejected", async () =>
{
    await assert.rejects(() => new AnalysisEngine().Analyze(Fixtures.Request(AnalyzeKind.Diagnostics, { BaseSetToken: 0, Documents: Fixtures.Documents })), /StaleBaseSet/);
});
