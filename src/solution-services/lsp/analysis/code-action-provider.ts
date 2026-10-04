import {
    CodeActionKind, type CodeAction, type Diagnostic, type Range, type Position, type TextEdit,
} from "vscode-languageserver-types";
import { DiagnosticCode } from "../../../compiler-services/diagnostics/diagnostic.js";
import { TokenKind } from "../../../compiler-services/parse/lexer.js";
import { DeclKind, type Declaration, type InstanceDecl } from "../../../compiler-services/parse/ast.js";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";

export class CodeActionProvider
{
    private static readonly MissingFieldPattern = /required\s+"[^".]+\.([^"]+)"/;
    private static readonly TitlePrefix = "Add missing field";
    // The inserted field stub `\n  <field> = ;`, split into its reused prefix/suffix.
    private static readonly FieldEditPrefix = "\n  ";
    private static readonly FieldEditSuffix = " = ;";

    public CodeActions(a: AnalysisSnapshot, uri: string, _range: Range, diagnostics: Diagnostic[]): CodeAction[]
    {
        const actions: CodeAction[] = [];
        for (const diag of diagnostics)
        {
            if (diag.code !== DiagnosticCode.RequiredMissing) continue;
            const action = this.addMissingField(a, uri, diag);
            if (action !== null) actions.push(action);
        }
        return actions;
    }

    // The diagnostic's range starts on the offending instance; insert `\n  <field> = ;`
    // just after that instance's opening brace.
    private addMissingField(a: AnalysisSnapshot, uri: string, diag: Diagnostic): CodeAction | null
    {
        const field = this.messageField(diag);
        if (field === "") return null;
        const at = this.openBracePosition(a, uri, diag.range.start);
        if (at === null) return null;
        const edit: TextEdit = { range: { start: at, end: at }, newText: `${CodeActionProvider.FieldEditPrefix}${field}${CodeActionProvider.FieldEditSuffix}` };
        return {
            title: `${CodeActionProvider.TitlePrefix} "${field}"`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
            edit: { changes: { [uri]: [edit] } },
        };
    }

    // The field name from a required-missing diagnostic, parsed from its message tail
    // `required "<concept>.<field>" is missing on …`.
    private messageField(diag: Diagnostic): string
    {
        const m = CodeActionProvider.MissingFieldPattern.exec(diag.message);
        return m?.[1] ?? "";
    }

    // The 0-based position just after the opening `{` of the instance whose record
    // starts at `start` (the diagnostic's range start, on the instance line).
    private openBracePosition(a: AnalysisSnapshot, uri: string, start: Position): Position | null
    {
        const file = a.Sources.get(uri);
        if (file === undefined) return null;
        const inst = this.instanceAtLine(file.ast.declarations, start.line + 1);
        if (inst === null) return null;
        for (const t of file.tokens)
        {
            const afterStart = t.line > inst.span.start.line || (t.line === inst.span.start.line && t.column >= inst.span.start.column);
            if (afterStart && t.kind === TokenKind.LBrace)
            {
                return { line: t.endLine - 1, character: t.endColumn - 1 };
            }
        }
        return null;
    }

    private instanceAtLine(decls: Declaration[], line1: number): InstanceDecl | null
    {
        for (const decl of decls)
        {
            if (decl.kind !== DeclKind.Instance) continue;
            if (decl.span.start.line === line1) return decl;
            const nested = this.instanceAtLine(decl.children, line1);
            if (nested !== null) return nested;
        }
        return null;
    }
}
