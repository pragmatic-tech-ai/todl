import type { Location, Position } from "vscode-languageserver-types";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";
import { ContextKind, CursorClassifier } from "./cursor-classifier.js";
import { Positions } from "./positions.js";
import { WrittenSymbolResolver } from "./written-symbol-resolver.js";

export class NavigationProvider
{
    public DefinitionAt(a: AnalysisSnapshot, uri: string, pos: Position): Location | null
    {
        const written = this.symbolAt(a, uri, pos);
        if (written === null) return null;
        const symbol = WrittenSymbolResolver.ResolveIn(a, uri, written);
        if (symbol === undefined) return null;
        const span = a.Model.spanOf(symbol);   // null for base symbols with no source span (boundary)
        if (span === null) return null;
        return { uri: span.uri, range: Positions.SpanToRange(span) };
    }

    public ReferencesAt(a: AnalysisSnapshot, uri: string, pos: Position, includeDecl: boolean): Location[]
    {
        const written = this.symbolAt(a, uri, pos);
        if (written === null) return [];
        const symbol = WrittenSymbolResolver.ResolveIn(a, uri, written);
        if (symbol === undefined) return [];
        // The index is keyed by written text: translate each occurrence to its qualified id.
        const locations: Location[] = a.Refs.All()
            .filter((o) => o.Symbol !== "" && WrittenSymbolResolver.ResolveIn(a, o.Uri, o.Symbol) === symbol)
            .map((o) => ({ uri: o.Uri, range: o.Range }));
        if (includeDecl)
        {
            const span = a.Model.spanOf(symbol);
            if (span !== null) locations.unshift({ uri: span.uri, range: Positions.SpanToRange(span) });
        }
        return locations;
    }

    // Resolve the symbol under the cursor (a reference occurrence classifies as
    // Identifier and carries its symbol id).
    private symbolAt(a: AnalysisSnapshot, uri: string, pos: Position): string | null
    {
        const ctx = CursorClassifier.ClassifyPosition(a, uri, pos);
        return ctx.Kind === ContextKind.Identifier && ctx.Symbol !== undefined ? ctx.Symbol : null;
    }
}
