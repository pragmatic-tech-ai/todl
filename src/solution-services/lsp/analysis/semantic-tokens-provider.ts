import type { SemanticTokens, SemanticTokensLegend, Range } from "vscode-languageserver-types";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";
import { Role } from "./reference-index.js";
import { SymbolKind } from "./symbol-kinds.js";

type TokenType = "type" | "class" | "enumMember" | "property" | "method" | "variable";

interface Raw { line: number; char: number; len: number; type: number }

export class SemanticTokensProvider
{
    // The token-type legend, ordered — the encoded `tokenType` field indexes this.
    private static readonly Types: readonly TokenType[] = ["type", "class", "enumMember", "property", "method", "variable"];
    public static readonly Legend: SemanticTokensLegend = { tokenTypes: [...SemanticTokensProvider.Types], tokenModifiers: [] };
    private static readonly TypeIndex: Record<TokenType, number> = { type: 0, class: 1, enumMember: 2, property: 3, method: 4, variable: 5 };

    // A reference role → token type. Concepts are 'type'; targets are concepts too.
    private static readonly RoleType: Record<Role, TokenType> = {
        [Role.Extends]: "type", [Role.FieldType]: "type", [Role.RelationshipTarget]: "type",
        [Role.InstanceConcept]: "type", [Role.InstanceOf]: "type", [Role.Represents]: "type",
        [Role.AnnotationName]: "type",
        [Role.RefValue]: "variable", [Role.Import]: "class",
    };

    public Of(a: AnalysisSnapshot, uri: string): SemanticTokens
    {
        const raws: Raw[] = [];
        for (const occ of a.Refs.All())
        {
            if (occ.Uri !== uri || occ.Symbol === "") continue;
            raws.push(this.toRaw(occ.Range, SemanticTokensProvider.TypeIndex[SemanticTokensProvider.RoleType[occ.Role]]));
        }
        for (const def of a.Defs.All())
        {
            if (def.Uri !== uri) continue;
            raws.push(this.toRaw(def.NameRange, SemanticTokensProvider.TypeIndex[this.defType(def.Kind)]));
        }
        raws.sort((x, y) => (x.line - y.line) || (x.char - y.char));

        const data: number[] = [];
        let prevLine = 0, prevChar = 0;
        for (const r of raws)
        {
            const dLine = r.line - prevLine;
            const dChar = dLine === 0 ? r.char - prevChar : r.char;
            data.push(dLine, dChar, r.len, r.type, 0);
            prevLine = r.line; prevChar = r.char;
        }
        return { data };
    }

    // A definition kind → token type.
    private defType(kind: SymbolKind): TokenType
    {
        switch (kind)
        {
            case SymbolKind.Concept: return "type";
            case SymbolKind.Primitive: case SymbolKind.Taxonomy: return "class";
            case SymbolKind.Term: return "enumMember";
            case SymbolKind.Field: return "property";
            case SymbolKind.Relationship: return "method";
            default: return "variable";
        }
    }

    private toRaw(range: Range, type: number): Raw
    {
        return { line: range.start.line, char: range.start.character, len: range.end.character - range.start.character, type };
    }
}
