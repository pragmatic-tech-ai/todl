import { MarkupKind, type Hover, type Position } from "vscode-languageserver-types";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";
import { ContextKind, CursorClassifier } from "./cursor-classifier.js";
import { SymbolKind, SymbolKinds } from "./symbol-kinds.js";

export class HoverProvider
{
    private static readonly KindLabel: Record<SymbolKind, string> = {
        [SymbolKind.Concept]: "concept", [SymbolKind.Primitive]: "primitive",
        [SymbolKind.Taxonomy]: "taxonomy", [SymbolKind.Term]: "term",
        [SymbolKind.Instance]: "instance", [SymbolKind.Field]: "field",
        [SymbolKind.Relationship]: "relationship", [SymbolKind.Unknown]: "symbol",
    };
    private static readonly CodeFence = "```";
    private static readonly CodeFenceOpen = "```todl";
    private static readonly DescriptionAttr = "description";
    private static readonly Newline = "\n";
    private static readonly TargetSeparator = " | ";

    public HoverAt(a: AnalysisSnapshot, uri: string, pos: Position): Hover | null
    {
        const ctx = CursorClassifier.ClassifyPosition(a, uri, pos);
        if (ctx.Kind !== ContextKind.Identifier || ctx.Symbol === undefined) return null;
        const symbol = ctx.Symbol;
        const kind = SymbolKinds.Of(a.Model, symbol);
        const lines = [HoverProvider.CodeFenceOpen, `${HoverProvider.KindLabel[kind]} ${symbol}`, HoverProvider.CodeFence];

        if (kind === SymbolKind.Concept)
        {
            const schema = a.Model.schemaOf(symbol);
            if (schema.extends !== null) lines.push(`extends \`${schema.extends}\``);
            for (const f of schema.fields) lines.push(`- \`${f.name}\`: ${f.type}`);
            for (const r of schema.relationships) lines.push(`- \`${r.name}\` → ${r.targets.join(HoverProvider.TargetSeparator)}`);
        }
        const node = a.Model.resolve(symbol);
        const description = node?.attrs.get(HoverProvider.DescriptionAttr);
        if (typeof description === "string" && description.length > 0) lines.push("", description);

        return { contents: { kind: MarkupKind.Markdown, value: lines.join(HoverProvider.Newline) } };
    }
}
