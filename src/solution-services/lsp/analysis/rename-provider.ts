import type { Range, Position, WorkspaceEdit, TextEdit } from "vscode-languageserver-types";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";
import { WrittenSymbolResolver } from "./written-symbol-resolver.js";
import { NodeIdQualifier } from "../../../compiler-services/parse/node-id-qualifier.js";

export interface RenameError { Error: string }

export class RenameProvider
{
    private static readonly Kebab = /^[a-z][a-z0-9-]*$/;
    private static readonly NothingToRename = "Nothing to rename here.";

    public PrepareRename(a: AnalysisSnapshot, uri: string, pos: Position): Range | null
    {
        return this.resolve(a, uri, pos)?.range ?? null;
    }

    public RenameEdits(a: AnalysisSnapshot, uri: string, pos: Position, newName: string): WorkspaceEdit | RenameError
    {
        const target = this.resolve(a, uri, pos);
        if (target === null) return { Error: RenameProvider.NothingToRename };
        if (!RenameProvider.Kebab.test(newName)) return { Error: `"${newName}" is not a valid kebab-case name.` };
        const ast = a.Sources.get(uri)?.ast;
        if (a.Model.has(NodeIdQualifier.Qualify(ast === undefined || ast.path === "" ? null : ast.path, newName))) return { Error: `"${newName}" already exists.` };

        const symbol = target.symbol;
        const edits: { uri: string; edit: TextEdit }[] = [];
        // Indexes are keyed by written text: translate each to its qualified id at query time.
        const qid = WrittenSymbolResolver.ResolveIn(a, uri, symbol);
        const same = (u: string, w: string): boolean => qid === undefined ? w === symbol : WrittenSymbolResolver.ResolveIn(a, u, w) === qid;
        for (const def of a.Defs.All())
        {
            if (same(def.Uri, def.Symbol)) edits.push({ uri: def.Uri, edit: { range: def.NameRange, newText: newName } });
        }
        for (const occ of a.Refs.All())
        {
            if (occ.Symbol !== "" && same(occ.Uri, occ.Symbol)) edits.push({ uri: occ.Uri, edit: { range: occ.Range, newText: newName } });
        }

        const changes: Record<string, TextEdit[]> = {};
        for (const { uri: u, edit } of edits) (changes[u] ??= []).push(edit);
        return { changes };
    }

    // Resolve the symbol under the cursor — a reference occurrence or a definition
    // name — tolerating a cursor on the identifier's trailing edge.
    private resolve(a: AnalysisSnapshot, uri: string, pos: Position): { symbol: string; range: Range } | null
    {
        const back = pos.character > 0 ? { line: pos.line, character: pos.character - 1 } : pos;
        const occ = a.Refs.OccurrenceAt(uri, pos) ?? a.Refs.OccurrenceAt(uri, back);
        if (occ !== null && occ.Symbol !== "") return { symbol: occ.Symbol, range: occ.Range };
        const def = a.Defs.DefinitionAt(uri, pos) ?? a.Defs.DefinitionAt(uri, back);
        if (def !== null) return { symbol: def.Symbol, range: def.NameRange };
        return null;
    }
}
