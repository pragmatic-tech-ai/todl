import type { Position } from "vscode-languageserver-types";
import { TokenKind, type Token } from "../../../compiler-services/parse/lexer.js";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";
import { Positions } from "./positions.js";

// A cursor's classified role. Reference occurrences resolve to `Identifier`
// (carrying the symbol); empty slots after a syntactic cue (`:`, `->`, `&`)
// classify by what the grammar expects there.
export enum ContextKind
{
    TypeSlot,
    RelationshipTarget,
    AssignmentName,
    RefValue,
    ImportPath,
    KeywordSlot,
    Identifier,
    None,
}

export interface CursorContext
{
    Kind: ContextKind;
    Word: string;
    Symbol?: string;
    OwnerConcept?: string;
}

export class CursorClassifier
{
    private static readonly ArrowOp = "->";
    private static readonly ImportKeyword = "import";

    public static ClassifyPosition(a: AnalysisSnapshot, uri: string, pos: Position): CursorContext
    {
        const file = a.Sources.get(uri);
        if (file === undefined) return { Kind: ContextKind.None, Word: "" };

        // First: is the cursor on a recorded reference occurrence? That's the
        // strongest signal (definition/hover of a real symbol). A cursor resting on
        // the identifier's trailing edge (exclusive-end boundary) should still resolve
        // it, so fall back one character — matching how editors treat end-of-word.
        const occ = a.Refs.OccurrenceAt(uri, pos)
            ?? (pos.character > 0 ? a.Refs.OccurrenceAt(uri, { line: pos.line, character: pos.character - 1 }) : null);
        if (occ !== null && occ.Symbol !== "")
        {
            return { Kind: ContextKind.Identifier, Word: occ.Symbol, Symbol: occ.Symbol };
        }

        const tp = Positions.PositionToTodl(pos);
        const tokens = file.tokens;
        const idx = CursorClassifier.tokenIndexAt(tokens, tp.line, tp.column);
        const prev = CursorClassifier.precedingSignificant(tokens, idx);

        // Empty slot after a syntactic cue.
        if (prev !== null)
        {
            if (prev.kind === TokenKind.Colon) return { Kind: ContextKind.TypeSlot, Word: CursorClassifier.wordAt(tokens, idx) };
            if (prev.kind === TokenKind.SymbolOp && prev.value === CursorClassifier.ArrowOp)
            {
                return { Kind: ContextKind.RelationshipTarget, Word: CursorClassifier.wordAt(tokens, idx) };
            }
            if (prev.kind === TokenKind.Amp) return { Kind: ContextKind.RefValue, Word: CursorClassifier.wordAt(tokens, idx) };
            if (prev.kind === TokenKind.Identifier && prev.value === CursorClassifier.ImportKeyword)
            {
                return { Kind: ContextKind.ImportPath, Word: CursorClassifier.wordAt(tokens, idx) };
            }
        }
        return { Kind: ContextKind.None, Word: CursorClassifier.wordAt(tokens, idx) };
    }

    // The index of the token whose span covers (line, column), else the index of the
    // next token after the cursor (so an empty slot points at what follows).
    private static tokenIndexAt(tokens: Token[], line: number, column: number): number
    {
        for (let i = 0; i < tokens.length; i += 1)
        {
            const t = tokens[i];
            if (t === undefined) continue;
            const startsAfter = t.line > line || (t.line === line && t.column > column);
            if (startsAfter) return i;
            const endsAfter = t.endLine > line || (t.endLine === line && t.endColumn > column);
            if ((t.line < line || (t.line === line && t.column <= column)) && endsAfter) return i;
        }
        return tokens.length;
    }

    // The nearest significant token before `idx` (skipping EOF); null if none.
    private static precedingSignificant(tokens: Token[], idx: number): Token | null
    {
        for (let i = idx - 1; i >= 0; i -= 1)
        {
            const t = tokens[i];
            if (t !== undefined && t.kind !== TokenKind.EOF) return t;
        }
        return null;
    }

    private static wordAt(tokens: Token[], idx: number): string
    {
        const t = tokens[idx];
        return t !== undefined && t.kind === TokenKind.Identifier ? t.value : "";
    }
}
