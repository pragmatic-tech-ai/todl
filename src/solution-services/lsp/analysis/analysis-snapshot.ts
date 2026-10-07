import type { Diagnostic } from "vscode-languageserver-types";
import { parse } from "../../../compiler-services/parse/parser.js";
import { tokenize, type Token } from "../../../compiler-services/parse/lexer.js";
import { checkAgainst } from "../../../compiler-services/api.js";
import type { SourceFile } from "../../../compiler-services/diagnostics/span.js";
import type { TodlDocument } from "../../../compiler-services/emit/json.js";
import type { Repository } from "../../../compiler-services/model/model.js";
import type { NamespaceNode } from "../../../compiler-services/parse/ast.js";
import { ReferenceIndex } from "./reference-index.js";
import { DefinitionIndex } from "./definition-index.js";
import { DiagnosticsMapper } from "./diagnostics-mapper.js";
import { ScopedRepository } from "./scoped-repository.js";
import type { GraphSlice } from "./graph-slice.js";

export interface ParsedSource { ast: NamespaceNode; tokens: Token[]; text: string }

// The whole-project analysis. Pure — recomputed from scratch by `Build`; the
// core keeps no cache (the server owns caching).
export class AnalysisSnapshot
{
    public readonly Sources: ReadonlyMap<string, ParsedSource>;
    public readonly Model: Repository;
    public readonly Refs: ReferenceIndex;
    public readonly Defs: DefinitionIndex;
    public readonly Diagnostics: readonly Diagnostic[];
    // Diagnostics grouped by file URI for per-document publishing. Every source
    // file has an entry (empty when clean, so a fixed file's squiggles clear);
    // whole-model (null-span) diagnostics attach to every file in the project.
    public readonly DiagnosticsByUri: ReadonlyMap<string, readonly Diagnostic[]>;

    private constructor(
        sources: ReadonlyMap<string, ParsedSource>,
        model: Repository,
        refs: ReferenceIndex,
        defs: DefinitionIndex,
        diagnostics: readonly Diagnostic[],
        diagnosticsByUri: ReadonlyMap<string, readonly Diagnostic[]>,
    )
    {
        this.Sources = sources;
        this.Model = model;
        this.Refs = refs;
        this.Defs = defs;
        this.Diagnostics = diagnostics;
        this.DiagnosticsByUri = diagnosticsByUri;
    }

    public static Build(sources: readonly SourceFile[], bases: readonly TodlDocument[] = []): AnalysisSnapshot
    {
        const parsed = new Map<string, ParsedSource>();
        const asts = new Map<string, NamespaceNode>();
        for (const src of sources)
        {
            const ast = parse(src.text, src.uri).namespace;
            parsed.set(src.uri, { ast, tokens: tokenize(src.text), text: src.text });
            asts.set(src.uri, ast);
        }
        const { model, diagnostics } = checkAgainst([...bases], [...sources]);

        // Map each diagnostic exactly once; the flat list and the per-URI buckets reuse
        // the SAME mapped object (no second pass over the raw diagnostics).
        const byUri = new Map<string, Diagnostic[]>();
        for (const src of sources) byUri.set(src.uri, []);
        const flat: Diagnostic[] = [];
        const wholeModel: Diagnostic[] = [];
        for (const d of diagnostics)
        {
            const lsp = DiagnosticsMapper.Map(d);
            flat.push(lsp);
            const uri = d.span?.uri ?? null;
            if (uri === null) { wholeModel.push(lsp); continue; }
            const list = byUri.get(uri);
            if (list === undefined) byUri.set(uri, [lsp]);
            else list.push(lsp);
        }
        // Whole-model diagnostics (no file) surface on every file in the project.
        if (wholeModel.length > 0) for (const list of byUri.values()) list.push(...wholeModel);

        return new AnalysisSnapshot(
            parsed,
            model,
            ReferenceIndex.Build(asts),
            DefinitionIndex.Build(asts),
            flat,
            byUri,
        );
    }

    // The shared-graph path: produce the IDENTICAL snapshot shape as `Build` for the
    // same `sources`, but without a fresh `checkAgainst` — the Model is the shared
    // whole-solution Repository (scoped to the project via `ScopedRepository`) and the
    // diagnostics come from the graph's already-computed per-file buckets. `sources`,
    // `Refs`, `Defs` and the diagnostics bucketing are built exactly as `Build` does,
    // so every feature method behaves identically. Parsing is kept (it is cheap); only
    // the per-request base-merge + load + validate recompile is eliminated.
    public static FromGraph(sources: readonly SourceFile[], slice: GraphSlice): AnalysisSnapshot
    {
        const parsed = new Map<string, ParsedSource>();
        const asts = new Map<string, NamespaceNode>();
        for (const src of sources)
        {
            const ast = parse(src.text, src.uri).namespace;
            parsed.set(src.uri, { ast, tokens: tokenize(src.text), text: src.text });
            asts.set(src.uri, ast);
        }

        // Map the project's own per-file diagnostics once; whole-model (null-span)
        // diagnostics surface on every project file, mirroring `Build`.
        const wholeModel = slice.WholeModelDiagnostics.map((d) => DiagnosticsMapper.Map(d));
        const byUri = new Map<string, Diagnostic[]>();
        const flat: Diagnostic[] = [];
        for (const src of sources)
        {
            const mapped = (slice.DiagnosticsByUri.get(src.uri) ?? []).map((d) => DiagnosticsMapper.Map(d));
            byUri.set(src.uri, mapped);
            flat.push(...mapped);
        }
        flat.push(...wholeModel);
        if (wholeModel.length > 0) for (const list of byUri.values()) list.push(...wholeModel);

        return new AnalysisSnapshot(
            parsed,
            new ScopedRepository(slice.Model, slice.VisibleIds, slice.OwnIds),
            ReferenceIndex.Build(asts),
            DefinitionIndex.Build(asts),
            flat,
            byUri,
        );
    }
}
