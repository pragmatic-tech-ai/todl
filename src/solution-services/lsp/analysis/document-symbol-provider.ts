import { SymbolKind as LspSymbolKind, type DocumentSymbol, type Range } from "vscode-languageserver-types";
import type { SourceSpan } from "../../../compiler-services/diagnostics/span.js";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";
import { Positions } from "./positions.js";
import {
    DeclKind, type Declaration, type ConceptDecl, type InstanceDecl, type ModelDecl,
} from "../../../compiler-services/parse/ast.js";

export class DocumentSymbolProvider
{
    public Of(a: AnalysisSnapshot, uri: string): DocumentSymbol[]
    {
        const ast = a.Sources.get(uri)?.ast;
        if (ast === undefined) return [];
        return ast.declarations.map((d) => this.toSymbol(d)).filter((s): s is DocumentSymbol => s !== null);
    }

    private toSymbol(decl: Declaration): DocumentSymbol | null
    {
        const range = Positions.SpanToRange(decl.span);
        switch (decl.kind)
        {
            case DeclKind.Primitive:
                return this.leaf(decl.name, LspSymbolKind.Struct, range, this.nameRange(decl.nameSpan, range));
            case DeclKind.Taxonomy:
                return this.leaf(decl.name, LspSymbolKind.Enum, range, this.nameRange(decl.nameSpan, range));
            case DeclKind.Viewpoint:
                return this.leaf(decl.name, LspSymbolKind.Interface, range, this.nameRange(decl.nameSpan, range));
            case DeclKind.Concept:
                return this.conceptSymbol(decl, range);
            case DeclKind.Instance:
                return this.instanceSymbol(decl, range);
            case DeclKind.Model:
                return this.modelSymbol(decl, range);
            case DeclKind.Annotation:
                return this.leaf(decl.name, LspSymbolKind.Interface, range, this.nameRange(decl.nameSpan, range));
            case DeclKind.Package:
                return null; // a package block has no name to surface as a symbol
            case DeclKind.Operator:
                return this.leaf(decl.glyph, LspSymbolKind.Operator, range, this.nameRange(decl.glyphSpan, range));
        }
    }

    private modelSymbol(decl: ModelDecl, range: Range): DocumentSymbol
    {
        const children = decl.instances.map((c) => this.instanceSymbol(c, Positions.SpanToRange(c.span)));
        const sym = this.leaf(decl.id, LspSymbolKind.Module, range, this.nameRange(decl.idSpan, range));
        if (children.length > 0) sym.children = children;
        return sym;
    }

    private conceptSymbol(decl: ConceptDecl, range: Range): DocumentSymbol
    {
        const children: DocumentSymbol[] = [];
        for (const f of decl.fields)
        {
            if (f.nameSpan !== undefined)
            {
                const r = Positions.SpanToRange(f.nameSpan);
                children.push(this.leaf(f.name, LspSymbolKind.Field, r, r));
            }
        }
        for (const rel of decl.relationships)
        {
            if (rel.nameSpan !== undefined)
            {
                const r = Positions.SpanToRange(rel.nameSpan);
                children.push(this.leaf(rel.name, LspSymbolKind.Method, r, r));
            }
        }
        const sym = this.leaf(decl.name, LspSymbolKind.Class, range, this.nameRange(decl.nameSpan, range));
        if (children.length > 0) sym.children = children;
        return sym;
    }

    private instanceSymbol(decl: InstanceDecl, range: Range): DocumentSymbol
    {
        const children = decl.children.map((c) => this.instanceSymbol(c, Positions.SpanToRange(c.span)));
        const sym = this.leaf(decl.id, LspSymbolKind.Object, range, this.nameRange(decl.idSpan, range));
        if (children.length > 0) sym.children = children;
        return sym;
    }

    private leaf(name: string, kind: LspSymbolKind, range: Range, selectionRange: Range): DocumentSymbol
    {
        return { name, kind, range, selectionRange };
    }

    private nameRange(span: SourceSpan | undefined, fallback: Range): Range
    {
        return span === undefined ? fallback : Positions.SpanToRange(span);
    }
}
