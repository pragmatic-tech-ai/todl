import type { TextEdit, Range } from "vscode-languageserver-types";
import type { AnalysisSnapshot } from "./analysis-snapshot.js";

export class FormattingProvider
{
    private static readonly Indent = "  ";
    private static readonly Newline = "\n";

    // Re-indent each line by its brace depth, trim trailing whitespace, and collapse
    // runs of blank lines to one. Only `{`/`}` outside strings and comments drive
    // depth, so cardinality `[]` and braces inside literals/comments are inert.
    public static FormatText(text: string): string
    {
        const lines = text.split(FormattingProvider.Newline);
        const hadTrailingNewline = text.endsWith(FormattingProvider.Newline);
        if (hadTrailingNewline) lines.pop();   // drop the empty element after the last newline

        const formatter = new FormattingProvider();
        const out: string[] = [];
        let depth = 0;
        let blankRun = 0;
        for (const raw of lines)
        {
            const trimmed = raw.trim();
            if (trimmed === "")
            {
                blankRun += 1;
                if (blankRun <= 1) out.push("");
                continue;
            }
            blankRun = 0;
            const startsClosing = trimmed.startsWith("}");
            const indentDepth = Math.max(0, depth - (startsClosing ? 1 : 0));
            out.push(FormattingProvider.Indent.repeat(indentDepth) + trimmed);
            depth = Math.max(0, depth + formatter.braceDelta(trimmed));
        }

        return out.join(FormattingProvider.Newline) + (hadTrailingNewline ? FormattingProvider.Newline : "");
    }

    public FormatDocument(a: AnalysisSnapshot, uri: string): TextEdit[]
    {
        const file = a.Sources.get(uri);
        if (file === undefined) return [];
        const formatted = FormattingProvider.FormatText(file.text);
        if (formatted === file.text) return [];
        return [{ range: this.fullRange(file.text), newText: formatted }];
    }

    // Net `{` minus `}` on a line, ignoring braces inside "…"/`//`/`/* */`.
    private braceDelta(line: string): number
    {
        let delta = 0;
        let i = 0;
        let inString = false;
        while (i < line.length)
        {
            const ch = line[i]!;
            if (inString)
            {
                if (ch === '"') inString = false;
                i += 1;
                continue;
            }
            if (ch === '"')
            {
                inString = true;
                i += 1;
                continue;
            }
            if (ch === "/" && line[i + 1] === "/") break;                 // line comment — rest ignored
            if (ch === "/" && line[i + 1] === "*")                        // block comment — skip to */
            {
                const end = line.indexOf("*/", i + 2);
                if (end === -1) break;
                i = end + 2;
                continue;
            }
            if (ch === "{") delta += 1;
            else if (ch === "}") delta -= 1;
            i += 1;
        }
        return delta;
    }

    private fullRange(text: string): Range
    {
        const lines = text.split(FormattingProvider.Newline);
        const last = lines.length - 1;
        return { start: { line: 0, character: 0 }, end: { line: last, character: lines[last]!.length } };
    }
}
