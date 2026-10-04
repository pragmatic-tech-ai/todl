import type { Range, Position } from "vscode-languageserver-types";
import type { SourceSpan } from "../../../compiler-services/diagnostics/span.js";
import {
    DeclKind, type NamespaceNode, type Declaration, type InstanceDecl, type Term,
} from "../../../compiler-services/parse/ast.js";
import { Positions } from "./positions.js";
import { SymbolKind } from "./symbol-kinds.js";

export interface Definition { Symbol: string; Uri: string; NameRange: Range; Kind: SymbolKind }

export class DefinitionIndex
{
    private readonly defs: Definition[];
    private readonly bySymbol: Map<string, Definition>;

    private constructor(defs: Definition[])
    {
        this.defs = defs;
        this.bySymbol = new Map<string, Definition>();
        for (const d of defs) if (!this.bySymbol.has(d.Symbol)) this.bySymbol.set(d.Symbol, d);
    }

    public static Build(files: Map<string, NamespaceNode>): DefinitionIndex
    {
        const defs: Definition[] = [];
        for (const [uri, ns] of files)
        {
            for (const decl of ns.declarations) DefinitionIndex.AddDecl(defs, uri, decl);
        }
        return new DefinitionIndex(defs);
    }

    public All(): Definition[]
    {
        return this.defs;
    }

    public Get(symbol: string): Definition | null
    {
        return this.bySymbol.get(symbol) ?? null;
    }

    public DefinitionAt(uri: string, pos: Position): Definition | null
    {
        return this.defs.find((d) => d.Uri === uri && DefinitionIndex.Contains(d.NameRange, pos)) ?? null;
    }

    private static Add(defs: Definition[], uri: string, symbol: string, span: SourceSpan | undefined, kind: SymbolKind): void
    {
        if (span === undefined) return;
        defs.push({ Symbol: symbol, Uri: uri, Kind: kind, NameRange: Positions.SpanToRange(span) });
    }

    private static AddDecl(defs: Definition[], uri: string, decl: Declaration): void
    {
        switch (decl.kind)
        {
            case DeclKind.Primitive: DefinitionIndex.Add(defs, uri, decl.name, decl.nameSpan, SymbolKind.Primitive); break;
            case DeclKind.Concept:   DefinitionIndex.Add(defs, uri, decl.name, decl.nameSpan, SymbolKind.Concept); break;
            case DeclKind.Taxonomy:
                DefinitionIndex.Add(defs, uri, decl.name, decl.nameSpan, SymbolKind.Taxonomy);
                for (const term of decl.terms) DefinitionIndex.AddTerm(defs, uri, term);
                break;
            case DeclKind.Instance:  DefinitionIndex.AddInstance(defs, uri, decl); break;
            case DeclKind.Model:
                DefinitionIndex.Add(defs, uri, decl.id, decl.idSpan, SymbolKind.Instance);
                for (const inst of decl.instances) DefinitionIndex.AddInstance(defs, uri, inst);
                break;
        }
    }

    private static AddInstance(defs: Definition[], uri: string, inst: InstanceDecl): void
    {
        DefinitionIndex.Add(defs, uri, inst.id, inst.idSpan, inst.isClass ? SymbolKind.Term : SymbolKind.Instance);
        for (const child of inst.children) DefinitionIndex.AddInstance(defs, uri, child);
    }

    private static AddTerm(defs: Definition[], uri: string, term: Term): void
    {
        // Terms are keyed by bare id — how they are referenced from instances.
        DefinitionIndex.Add(defs, uri, term.id, term.idSpan, SymbolKind.Term);
        for (const child of term.children) DefinitionIndex.AddTerm(defs, uri, child);
    }

    private static Contains(range: Range, pos: Position): boolean
    {
        const afterStart = pos.line > range.start.line ||
            (pos.line === range.start.line && pos.character >= range.start.character);
        const beforeEnd = pos.line < range.end.line ||
            (pos.line === range.end.line && pos.character < range.end.character);
        return afterStart && beforeEnd;
    }
}
