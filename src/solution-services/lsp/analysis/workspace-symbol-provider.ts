import { SymbolKind as LspSymbolKind, type WorkspaceSymbol } from "vscode-languageserver-types";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";
import { SymbolKind } from "./symbol-kinds.js";

export class WorkspaceSymbolProvider
{
    private static readonly ToLsp: Record<SymbolKind, LspSymbolKind> = {
        [SymbolKind.Concept]: LspSymbolKind.Class,
        [SymbolKind.Primitive]: LspSymbolKind.Struct,
        [SymbolKind.Taxonomy]: LspSymbolKind.Enum,
        [SymbolKind.Term]: LspSymbolKind.EnumMember,
        [SymbolKind.Instance]: LspSymbolKind.Object,
        [SymbolKind.Field]: LspSymbolKind.Field,
        [SymbolKind.Relationship]: LspSymbolKind.Method,
        [SymbolKind.Unknown]: LspSymbolKind.Null,
    };

    public Query(a: AnalysisSnapshot, query: string): WorkspaceSymbol[]
    {
        const needle = query.toLowerCase();
        const out: WorkspaceSymbol[] = [];
        for (const def of a.Defs.All())
        {
            if (needle !== "" && !def.Symbol.toLowerCase().includes(needle)) continue;
            out.push({
                name: def.Symbol,
                kind: WorkspaceSymbolProvider.ToLsp[def.Kind],
                location: { uri: def.Uri, range: def.NameRange },
            });
        }
        return out;
    }
}
