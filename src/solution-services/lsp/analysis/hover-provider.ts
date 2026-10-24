import { MarkupKind, type Hover, type Position } from "vscode-languageserver-types";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";
import { ContextKind, CursorClassifier } from "./cursor-classifier.js";
import { SymbolKind, SymbolKinds } from "./symbol-kinds.js";
import { WrittenSymbolResolver } from "./written-symbol-resolver.js";

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
    // Markdown fragments for the schema detail lines (reused across field/relationship
    // rows), kept out of the method bodies so the one home for each is here.
    private static readonly Backtick = "`";
    private static readonly ExtendsLabel = "extends";
    private static readonly Bullet = "- ";
    private static readonly FieldTypeSeparator = ": ";
    private static readonly RelationshipArrow = " → ";
    // An instance's recorded defects (`variant "…"`), listed under this heading.
    private static readonly VariantsHeading = "**Variants** — where this instance breaks a rule of its concept:";

    public HoverAt(a: AnalysisSnapshot, uri: string, pos: Position): Hover | null
    {
        const ctx = CursorClassifier.ClassifyPosition(a, uri, pos);
        if (ctx.Kind !== ContextKind.Identifier || ctx.Symbol === undefined) return null;
        const symbol = WrittenSymbolResolver.ResolveIn(a, uri, ctx.Symbol) ?? ctx.Symbol;
        const kind = SymbolKinds.Of(a.Model, symbol);
        const lines = [HoverProvider.CodeFenceOpen, `${HoverProvider.KindLabel[kind]} ${symbol}`, HoverProvider.CodeFence];

        if (kind === SymbolKind.Concept)
        {
            const schema = a.Model.schemaOf(symbol);
            if (schema.extends !== null) lines.push(`${HoverProvider.ExtendsLabel} ${HoverProvider.Code(schema.extends)}`);
            for (const f of schema.fields) lines.push(`${HoverProvider.Bullet}${HoverProvider.Code(f.name)}${HoverProvider.FieldTypeSeparator}${f.type}`);
            for (const r of schema.relationships) lines.push(`${HoverProvider.Bullet}${HoverProvider.Code(r.name)}${HoverProvider.RelationshipArrow}${r.targets.join(HoverProvider.TargetSeparator)}`);
        }
        const node = a.Model.resolve(symbol);
        const description = node?.attrs.get(HoverProvider.DescriptionAttr);
        if (typeof description === "string" && description.length > 0) lines.push("", description);
        const variants = node?.variants ?? [];
        if (variants.length > 0)
        {
            lines.push("", HoverProvider.VariantsHeading);
            for (const v of variants) lines.push(`${HoverProvider.Bullet}${v}`);
        }

        return { contents: { kind: MarkupKind.Markdown, value: lines.join(HoverProvider.Newline) } };
    }

    // Wrap a symbol name in a Markdown inline-code span.
    private static Code(text: string): string
    {
        return HoverProvider.Backtick + text + HoverProvider.Backtick;
    }
}
