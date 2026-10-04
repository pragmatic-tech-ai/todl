import type { Location, Position } from "vscode-languageserver-types";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";
import { ContextKind, CursorClassifier } from "./cursor-classifier.js";
import { Positions } from "./positions.js";

export class NavigationProvider
{
    public DefinitionAt(a: AnalysisSnapshot, uri: string, pos: Position): Location | null
    {
        const symbol = this.symbolAt(a, uri, pos);
        if (symbol === null) return null;
        const span = a.Model.spanOf(symbol);   // null for base symbols with no source span (boundary)
        if (span === null) return null;
        return { uri: span.uri, range: Positions.SpanToRange(span) };
    }

    public ReferencesAt(a: AnalysisSnapshot, uri: string, pos: Position, includeDecl: boolean): Location[]
    {
        const symbol = this.symbolAt(a, uri, pos);
        if (symbol === null) return [];
        const locations: Location[] = a.Refs.Get(symbol).map((o) => ({ uri: o.Uri, range: o.Range }));
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
