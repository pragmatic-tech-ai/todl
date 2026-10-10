import { CompletionItemKind, type CompletionItem, type Position } from "vscode-languageserver-types";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";
import { ContextKind, CursorClassifier } from "./cursor-classifier.js";
import { SymbolKind, SymbolKinds } from "./symbol-kinds.js";
import { SchemaContextResolver } from "./schema-context-resolver.js";

export class CompletionProvider
{
    private static readonly Keywords = ["namespace", "import", "concept", "primitive", "taxonomy", "relationship", "invariant", "instanceof", "variant"];
    private static readonly ConceptLabel = "concept";
    private static readonly PrimitiveLabel = "primitive";
    private static readonly TaxonomyLabel = "taxonomy";
    private static readonly SymbolLabel = "symbol";
    private static readonly DescriptionAttr = "description";

    public CompletionsAt(a: AnalysisSnapshot, uri: string, pos: Position): CompletionItem[]
    {
        const ctx = CursorClassifier.ClassifyPosition(a, uri, pos);
        switch (ctx.Kind)
        {
            case ContextKind.TypeSlot:
                return this.typeCandidates(a);
            case ContextKind.RelationshipTarget:
                return this.conceptCandidates(a);
            case ContextKind.RefValue:
                return this.refCandidates(a, uri, pos);
            case ContextKind.None:
                // Top-level (or unclassified) — offer the declaration keywords.
                return CompletionProvider.Keywords.map((label) => ({ label, kind: CompletionItemKind.Keyword }));
            default:
                return [];
        }
    }

    // Concepts + primitives + taxonomies are valid in a field-type slot.
    private typeCandidates(a: AnalysisSnapshot): CompletionItem[]
    {
        return this.nodesOfKinds(a, [SymbolKind.Concept, SymbolKind.Primitive, SymbolKind.Taxonomy]);
    }

    private conceptCandidates(a: AnalysisSnapshot): CompletionItem[]
    {
        return this.nodesOfKinds(a, [SymbolKind.Concept]);
    }

    private nodesOfKinds(a: AnalysisSnapshot, kinds: SymbolKind[]): CompletionItem[]
    {
        const items: CompletionItem[] = [];
        for (const node of a.Model.allNodes())
        {
            const kind = SymbolKinds.Of(a.Model, node.id);
            if (!kinds.includes(kind)) continue;
            items.push(this.withDoc({
                label: node.id,
                kind: kind === SymbolKind.Primitive ? CompletionItemKind.Struct : CompletionItemKind.Class,
                detail: this.labelFor(kind),
            }, this.describe(a, node.id)));
        }
        return items;
    }

    // A `&ref` value: offer instances of the assignment's target concept and its
    // subtypes. Falls back to all instances when the slot's target can't be resolved
    // (e.g. the member isn't in the schema).
    private refCandidates(a: AnalysisSnapshot, uri: string, pos: Position): CompletionItem[]
    {
        const ctx = SchemaContextResolver.AssignmentContextAt(a, uri, pos);
        const ids = ctx !== null && ctx.TargetConcepts.length > 0
            ? [...new Set(ctx.TargetConcepts.flatMap((c) => this.instancesForConcept(a, c)))]
            : this.allInstanceIds(a);
        return ids.map((id) => this.withDoc({ label: id, kind: CompletionItemKind.Variable }, this.describe(a, id)));
    }

    private instancesForConcept(a: AnalysisSnapshot, concept: string): string[]
    {
        const ids = new Set<string>(a.Model.instancesOf(concept));
        for (const sub of a.Model.subtypesOf(concept)) for (const i of a.Model.instancesOf(sub)) ids.add(i);
        return [...ids];
    }

    private allInstanceIds(a: AnalysisSnapshot): string[]
    {
        return a.Model.allNodes().filter((n) => SymbolKinds.Of(a.Model, n.id) === SymbolKind.Instance).map((n) => n.id);
    }

    // Attach documentation only when present — `exactOptionalPropertyTypes` forbids
    // an explicit `documentation: undefined`.
    private withDoc(item: CompletionItem, doc: string | undefined): CompletionItem
    {
        return doc === undefined ? item : { ...item, documentation: doc };
    }

    private labelFor(kind: SymbolKind): string
    {
        return kind === SymbolKind.Concept ? CompletionProvider.ConceptLabel
            : kind === SymbolKind.Primitive ? CompletionProvider.PrimitiveLabel
            : kind === SymbolKind.Taxonomy ? CompletionProvider.TaxonomyLabel : CompletionProvider.SymbolLabel;
    }

    private describe(a: AnalysisSnapshot, id: string): string | undefined
    {
        const d = a.Model.resolve(id)?.attrs.get(CompletionProvider.DescriptionAttr);
        return typeof d === "string" && d.length > 0 ? d : undefined;
    }
}
