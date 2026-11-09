/**
 * Faithful round-trip of a reopened `.todl` file whose own source declares schema beside its model. Regenerating such a
 * file from the graph would drop (or mangle) every non-instance declaration, so instead the original text is kept and
 * only the model block's BODY is replaced; the model header (id, meta-model, `uses`, `conforms`), every schema
 * declaration, and all comments and formatting outside the body stay byte-for-byte.
 */

import { parse } from "../compiler-services/parse/parser.js";
import { DeclKind, type ModelDecl } from "../compiler-services/parse/ast.js";
import type { Position } from "../compiler-services/diagnostics/span.js";
import { Severity } from "../compiler-services/diagnostics/diagnostic.js";

/** What one reopened file holds: its original text, whether it carries the model block (so it is always re-emitted,
 *  even after every instance in it was deleted), and whether it declares anything besides the model block and
 *  instances (so it is spliced, not regenerated). */
export class SourceLayout
{
  constructor(
    readonly Text: string,
    readonly HasModel: boolean,
    readonly HasSchema: boolean,
  )
  {
  }

  static Of(uri: string, text: string): SourceLayout
  {
    const declarations = parse(text, uri).namespace.declarations;
    return new SourceLayout(
      text,
      declarations.some((d) => d.kind === DeclKind.Model),
      declarations.some((d) => d.kind !== DeclKind.Model && d.kind !== DeclKind.Instance),
    );
  }
}

/** 1-based line/column → string offset over one text. */
class TextOffsets
{
  private readonly lineStarts: number[] = [0];

  constructor(text: string)
  {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === TextOffsets.Newline) this.lineStarts.push(i + 1);
  }

  private static readonly Newline = 10;

  At(position: Position): number
  {
    return this.lineStarts[position.line - 1]! + position.column - 1;
  }
}

/** One replacement over the original text: [Start, End) becomes Text. */
class TextEdit
{
  constructor(readonly Start: number, readonly End: number, readonly Text: string)
  {
  }
}

export class ModelBlockSplicer
{
  private static readonly Open = "{";
  private static readonly Close = "}";
  private static readonly UsesKeyword = " uses ";
  private static readonly ListSeparator = ", ";
  private static readonly ImportPrefix = "\n  import ";
  private static readonly StatementEnd = ";";
  private static readonly Indent = "  ";
  private static readonly Newline = "\n";
  private static readonly UnparseableOriginal = "cannot splice a model into a file that does not parse";
  private static readonly SeveralModels = "cannot splice into a file with more than one model block";
  private static readonly UnparseableResult = "refusing to write a spliced model file that does not parse";

  /** `original` with its model body replaced by `emitted`'s (or the emitted model block inserted when `original` has
   *  none), plus any import / `uses` library the emitted model needs that `original` lacks. Throws rather than return
   *  text that does not parse. */
  static Splice(uri: string, original: string, emitted: string): string
  {
    const source = parse(original, uri);
    if (source.diagnostics.some((d) => d.severity === Severity.Error)) throw new Error(ModelBlockSplicer.UnparseableOriginal);
    const models = ModelBlockSplicer.Models(source.namespace.declarations);
    if (models.length > 1) throw new Error(ModelBlockSplicer.SeveralModels);
    const generated = parse(emitted, uri);
    const generatedModel = ModelBlockSplicer.Models(generated.namespace.declarations)[0];
    const at = new TextOffsets(original);
    const edits: TextEdit[] = [];

    const model = models[0];
    if (model === undefined)
    {
      if (generatedModel !== undefined)
      {
        const close = at.At(source.namespace.span.end) - 1;
        const block = ModelBlockSplicer.Slice(emitted, generatedModel);
        edits.push(new TextEdit(close, close, ModelBlockSplicer.Indent + block + ModelBlockSplicer.Newline));
      }
    }
    else
    {
      const [bodyStart, bodyEnd] = ModelBlockSplicer.BodyRange(original, model, at);
      const body = generatedModel === undefined ? ModelBlockSplicer.Newline + ModelBlockSplicer.Indent : ModelBlockSplicer.Body(emitted, generatedModel);
      edits.push(new TextEdit(bodyStart, bodyEnd, body));
      const missingUses = (generatedModel?.libraries ?? []).filter((l) => !model.libraries.includes(l));
      if (missingUses.length > 0) edits.push(ModelBlockSplicer.UsesEdit(model, missingUses, at));
    }

    const missingImports = generated.namespace.imports.filter((i) => !source.namespace.imports.includes(i));
    if (missingImports.length > 0)
    {
      const open = original.indexOf(ModelBlockSplicer.Open, at.At(source.namespace.span.start)) + 1;
      const lines = missingImports.map((i) => ModelBlockSplicer.ImportPrefix + i + ModelBlockSplicer.StatementEnd).join("");
      edits.push(new TextEdit(open, open, lines));
    }

    let text = original;
    for (const edit of edits.sort((a, b) => b.Start - a.Start)) text = text.slice(0, edit.Start) + edit.Text + text.slice(edit.End);
    if (parse(text, uri).diagnostics.some((d) => d.severity === Severity.Error)) throw new Error(ModelBlockSplicer.UnparseableResult);
    return text;
  }

  private static Models(declarations: readonly { kind: DeclKind }[]): ModelDecl[]
  {
    return declarations.filter((d): d is ModelDecl => d.kind === DeclKind.Model);
  }

  private static Slice(text: string, model: ModelDecl): string
  {
    const at = new TextOffsets(text);
    return text.slice(at.At(model.span.start), at.At(model.span.end));
  }

  // The model header carries no braces, so the body is everything between the block's first "{" and its final "}".
  private static BodyRange(text: string, model: ModelDecl, at: TextOffsets): [number, number]
  {
    const start = text.indexOf(ModelBlockSplicer.Open, at.At(model.span.start)) + 1;
    const end = text.lastIndexOf(ModelBlockSplicer.Close, at.At(model.span.end) - 1);
    return [start, end];
  }

  private static Body(text: string, model: ModelDecl): string
  {
    const [start, end] = ModelBlockSplicer.BodyRange(text, model, new TextOffsets(text));
    return text.slice(start, end);
  }

  // Appends libraries to the original `uses` list, or adds a `uses` clause right after the meta-model.
  private static UsesEdit(model: ModelDecl, missing: readonly string[], at: TextOffsets): TextEdit
  {
    const last = model.librarySpans?.[model.librarySpans.length - 1];
    if (last !== undefined)
    {
      const end = at.At(last.end);
      return new TextEdit(end, end, ModelBlockSplicer.ListSeparator + missing.join(ModelBlockSplicer.ListSeparator));
    }
    const end = at.At(model.metaModelSpan!.end);
    return new TextEdit(end, end, ModelBlockSplicer.UsesKeyword + missing.join(ModelBlockSplicer.ListSeparator));
  }
}
