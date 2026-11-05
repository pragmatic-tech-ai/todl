import type { DeriveDecl } from "./ast.js";

/** Serializes a concept's `derive` entries for the `Builder.DerivesAttr` node attribute. */
export class DeriveSerializer
{
  /** JSON list of `{ member, expression }`; `expression` is the original source text. */
  public static ToJson(derives: readonly DeriveDecl[], sourceText: string): string
  {
    const lineStarts = DeriveSerializer.LineStarts(sourceText);
    return JSON.stringify(derives.map((d) => ({
      member: d.member,
      expression: DeriveSerializer.Slice(sourceText, lineStarts, d),
    })));
  }

  /** Source slice from the first to the last expression token ("" when empty). */
  private static Slice(text: string, lineStarts: readonly number[], derive: DeriveDecl): string
  {
    const first = derive.expression[0];
    const last = derive.expression[derive.expression.length - 1];
    if (first === undefined || last === undefined) return "";
    const from = DeriveSerializer.Offset(lineStarts, first.line, first.column);
    const to = DeriveSerializer.Offset(lineStarts, last.endLine, last.endColumn);
    return text.slice(from, to);
  }

  /** Offsets of each line start (lines and columns are 1-based). */
  private static LineStarts(text: string): number[]
  {
    const starts = [0];
    for (let i = 0; i < text.length; i++)
    {
      if (text[i] === "\n") starts.push(i + 1);
    }
    return starts;
  }

  private static Offset(lineStarts: readonly number[], line: number, column: number): number
  {
    return (lineStarts[line - 1] ?? 0) + column - 1;
  }
}
