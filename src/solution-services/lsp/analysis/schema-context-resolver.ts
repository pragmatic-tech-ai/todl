import type { Position } from "vscode-languageserver-types";
import { TokenKind, type Token } from "../../../compiler-services/parse/lexer.js";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";
import { Positions } from "./positions.js";
import { WrittenSymbolResolver } from "./written-symbol-resolver.js";

export interface AssignmentContext
{
    Concept: string;
    Member: string;
    TargetConcepts: string[];
    Cardinality: number;
    IsRelationship: boolean;
}

interface TodlCursor
{
    line: number;
    column: number;
}

export class SchemaContextResolver
{
    // Resolve the assignment slot at `pos`: the enclosing record's concept, the
    // member name to its left (`<member> = …`), and that member's declared type or
    // relationship target from the effective schema. Null when the cursor is not in
    // an `<member> = <value>` position inside a record body.
    //
    // This works purely off the token stream (which `tokenize` produces regardless
    // of parse errors), so it still resolves while the user is mid-typing an
    // incomplete value like `owner = &` — exactly when completion fires.
    public static AssignmentContextAt(a: AnalysisSnapshot, uri: string, pos: Position): AssignmentContext | null
    {
        const file = a.Sources.get(uri);
        if (file === undefined) return null;
        const tp = Positions.PositionToTodl(pos);

        const member = SchemaContextResolver.memberBeforeCursor(file.tokens, tp);
        if (member === null) return null;
        const writtenConcept = SchemaContextResolver.enclosingConcept(file.tokens, tp);
        if (writtenConcept === null) return null;

        // The record header names the concept AS WRITTEN (bare / qualified); the
        // Model is keyed by canonical namespace-qualified ids, so resolve it to that
        // id for the schema lookup (else `effectiveSchema` sees nothing and the slot
        // loses its target concept). The `Concept` field keeps the written token.
        const resolvedConcept = WrittenSymbolResolver.ResolveIn(a, uri, writtenConcept) ?? writtenConcept;
        const schema = a.Model.effectiveSchema(resolvedConcept);
        const rel = schema.relationships.find((r) => r.name === member);
        if (rel !== undefined)
        {
            return { Concept: writtenConcept, Member: member, TargetConcepts: rel.targets, Cardinality: rel.cardinality, IsRelationship: true };
        }
        const field = schema.fields.find((f) => f.name === member);
        if (field !== undefined)
        {
            return { Concept: writtenConcept, Member: member, TargetConcepts: [field.type], Cardinality: field.cardinality, IsRelationship: false };
        }
        return { Concept: writtenConcept, Member: member, TargetConcepts: [], Cardinality: 0, IsRelationship: false };
    }

    // Index of the first token starting at/after the cursor (else the end).
    private static cursorIndex(tokens: Token[], tp: TodlCursor): number
    {
        const idx = tokens.findIndex((t) => t.line > tp.line || (t.line === tp.line && t.column >= tp.column));
        return idx === -1 ? tokens.length : idx;
    }

    // The concept of the record enclosing the cursor: brace-match backwards to the
    // opening `{`, then take the leftmost identifier of the record header
    // (`<concept> <id> [instanceof X] [: Bind] {`).
    private static enclosingConcept(tokens: Token[], tp: TodlCursor): string | null
    {
        const start = SchemaContextResolver.cursorIndex(tokens, tp);
        let depth = 0;
        let openIdx = -1;
        for (let i = start - 1; i >= 0; i -= 1)
        {
            const k = tokens[i]?.kind;
            if (k === TokenKind.RBrace)
            {
                depth += 1;
            }
            else if (k === TokenKind.LBrace)
            {
                if (depth === 0)
                {
                    openIdx = i;
                    break;
                }
                depth -= 1;
            }
        }
        if (openIdx < 0) return null;
        let concept: string | null = null;
        for (let i = openIdx - 1; i >= 0; i -= 1)
        {
            const t = tokens[i];
            if (t === undefined) continue;
            if (t.kind === TokenKind.Semicolon || t.kind === TokenKind.LBrace || t.kind === TokenKind.RBrace) break;
            if (t.kind === TokenKind.Identifier) concept = t.value;   // leftmost wins
        }
        return concept;
    }

    // Scan back from the cursor for the `<identifier> =` pattern; return the
    // identifier — the member being assigned. Stops at a statement/block boundary.
    private static memberBeforeCursor(tokens: Token[], tp: TodlCursor): string | null
    {
        const start = SchemaContextResolver.cursorIndex(tokens, tp);
        for (let i = start - 1; i >= 0; i -= 1)
        {
            const t = tokens[i];
            if (t === undefined) continue;
            if (t.kind === TokenKind.Equals)
            {
                const name = tokens[i - 1];
                return name !== undefined && name.kind === TokenKind.Identifier ? name.value : null;
            }
            if (t.kind === TokenKind.Semicolon || t.kind === TokenKind.LBrace || t.kind === TokenKind.RBrace) return null;
        }
        return null;
    }
}
