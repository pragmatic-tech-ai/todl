/**
 * Recursive-descent parser for TODL declarations (design spec §3): a single
 * `namespace` block of imports and `primitive` / `enum` / `concept`
 * declarations. Fields and relationships carry `?` / `[]` / `[+]` cardinality;
 * invariant predicates are captured as raw token slices for the predicate
 * parser. Strict: every statement ends in `;`; mismatches fail loud with
 * line:column.
 *
 * ──────────────────────────── Where this sits ──────────────────────────────
 * This is the middle stage of the front end: the LEXER (lexer.ts) turns source
 * text into a flat `Token[]`; THIS FILE consumes those tokens and builds an AST
 * of typed nodes (defined in ast.ts); the LOADER (loader.ts) then walks that AST
 * and stages it into the reflective graph. The parser is purely SYNTACTIC — it
 * never resolves names, never looks up types, never touches the graph. Anything
 * type-directed (attr-vs-edge, namespace visibility, forward refs) is the
 * loader's job; here we only decide "what shape is this text".
 *
 * ─────────────────────── Hand-written recursive descent ─────────────────────
 * There is no parser generator. Each grammar production is a `parse<Thing>`
 * method that reads tokens left-to-right through a single moving cursor (`pos`)
 * and calls sub-productions directly. Because the cursor only ever moves
 * forward, the grammar must be decidable with bounded LOOKAHEAD: a handful of
 * predicate helpers (`objectAhead`, `edgeApplicationAhead`, `tryParseTerm`)
 * peek a few tokens ahead to pick between two productions that share a prefix
 * (e.g. `foo { … }` an inline object vs `foo` a bare name; `a ==> b` an edge vs
 * `a` a name). See the "Cursor helpers" section for the read primitives.
 *
 * ───────────────────────── Spans (source locations) ─────────────────────────
 * Every AST node records the source region it came from so downstream
 * diagnostics can point back at the exact text. The idiom, used everywhere:
 * capture the FIRST token before parsing a production (`const start =
 * this.startToken()`), then call `this.spanFrom(start)` AFTER — which spans from
 * `start` through the LAST CONSUMED token (the one just behind the cursor).
 * Single-token spans use `tokenSpan(tok, uri)` directly.
 *
 * ────────────────────── Errors & recovery (synchronize) ─────────────────────
 * A syntax error throws a {@link ParseError} carrying the offending token. Two
 * things catch it: the top-level {@link Parser.parse} (a hard failure — record
 * one diagnostic and bail with an empty namespace), and the per-declaration loop
 * in {@link Parser.parseNamespace} (soft failure — record the diagnostic, then
 * {@link Parser.synchronize} skips forward to the next declaration boundary and
 * keeps going). Recovery means one bad declaration does not abort the whole
 * file; the loop guarantees forward progress so it can never spin.
 */

import { lex, TokenKind, type Token } from "./lexer.js";
import { Cardinality } from "../model/graph.js";
import { type SourceSpan, tokenSpan } from "../diagnostics/span.js";
import { type Diagnostic, DiagnosticCode, Severity } from "../diagnostics/diagnostic.js";
import {
  DeclKind,
  ValueKind,
  type NamespaceNode,
  type Declaration,
  type ConceptDecl,
  type PrimitiveDecl,
  type FieldDecl,
  type RelationshipDecl,
  type InvariantDecl,
  type Term,
  type TaxonomyDecl,
  type ViewpointDecl,
  type InstanceDecl,
  type ModelDecl,
  type AnnotationDecl,
  type AnnotationApplication,
  type PackageDecl,
  type OperatorDecl,
  type EdgeApplication,
  type AssignmentNode,
  type ValueNode,
  type ObjectValue,
} from "./ast.js";

/** What a parse produces: the single top-level {@link NamespaceNode} (its path,
 * imports, and declarations) plus every diagnostic gathered — from the lexer AND
 * from this parser's own recovery. */
export interface ParseResult
{
  namespace: NamespaceNode;
  diagnostics: Diagnostic[];
}

/** Parse one `.todl` source file into an AST. The single public entry point:
 * lex the text, then hand the tokens to a fresh {@link Parser}. Lexer
 * diagnostics are threaded in so parser recovery can append to the same list. */
export function parse(source: string, uri = "<anonymous>"): ParseResult
{
  const { tokens, diagnostics } = lex(source, uri);
  return new Parser(tokens, uri, diagnostics).parse();
}

/** Thrown internally on a syntax error; carries the offending token for spanning. */
class ParseError extends Error
{
  constructor(message: string, readonly token: Token)
  {
    super(message);
  }
}

/**
 * The recursive-descent engine. Holds the token stream, the current file `uri`
 * (for spanning), and the shared diagnostics list. `pos` is the single cursor
 * into `tokens`; every read primitive is expressed relative to it. Construct one
 * per file and call {@link Parser.parse} once.
 */
class Parser
{
  /** Index of the next UNCONSUMED token — the whole parser's only mutable state. */
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly uri: string,
    private readonly diagnostics: Diagnostic[],
  ) {}

  /** Top-level driver: parse the file's one namespace block. A {@link ParseError}
   * escaping here is a hard failure (recovery inside parseNamespace didn't catch
   * it) — record it and return an empty namespace so the caller still gets a
   * well-formed result. Non-ParseError throws are bugs and re-propagate. */
  parse(): ParseResult
  {
    try
    {
      const namespace = this.parseNamespace();
      return { namespace, diagnostics: this.diagnostics };
    }
    catch (err)
    {
      if (!(err instanceof ParseError)) throw err;
      this.diagnostics.push(this.toDiagnostic(err));
      const span = tokenSpan(err.token, this.uri);
      return { namespace: { path: "", imports: [], declarations: [], span }, diagnostics: this.diagnostics };
    }
  }

  /** Convert a caught {@link ParseError} into a diagnostic spanning its token. */
  private toDiagnostic(err: ParseError): Diagnostic
  {
    return {
      code: DiagnosticCode.UnexpectedToken,
      severity: Severity.Error,
      message: err.message,
      span: tokenSpan(err.token, this.uri),
      node: null,
      path: null,
    };
  }

  // ══════════════════════════ Error recovery & spans ═══════════════════════════

  /** Skip tokens after a syntax error to the next declaration boundary. Brace-aware
   * so an inner `}` isn't mistaken for the namespace's closing brace.
   *
   * Recovery strategy: after a declaration fails to parse, the cursor is stranded
   * somewhere mid-declaration. We walk forward tracking brace `depth`, discarding
   * the garbage, and stop at the first place a NEW declaration could legally begin
   * — a top-level (`depth === 0`) declaration keyword or bare identifier — or at
   * the `}` that closes the enclosing namespace. Stopping at depth 0 keeps us from
   * treating a nested `}` as the namespace terminator and ending the file early. */
  private synchronize(): void
  {
    let depth = 0;
    while (!this.check(TokenKind.EOF))
    {
      const kind = this.current().kind;
      if (kind === TokenKind.LBrace)
      {
        depth += 1;
        this.advance();
        continue;
      }
      if (kind === TokenKind.RBrace)
      {
        if (depth === 0) return; // closes the enclosing namespace — stop here
        depth -= 1;
        this.advance();
        continue;
      }
      if (
        depth === 0 &&
        (this.checkKeyword("primitive") ||
          this.checkKeyword("taxonomy") ||
          this.checkKeyword("concept") ||
          this.checkKeyword("internal") ||
          this.checkKeyword("sealed") ||
          kind === TokenKind.Identifier)
      )
      {
        return;
      }
      this.advance();
    }
  }

  /** The next unconsumed token — the start of whatever we're about to parse.
   * Capture this BEFORE a production, pair it with {@link Parser.spanFrom} after. */
  private startToken(): Token
  {
    return this.current();
  }

  /** Span from `start` through the last consumed token (the one before the cursor).
   * The end anchor is `tokens[pos - 1]` (falling back to `start` when nothing has
   * been consumed yet), so the span covers exactly the tokens the production ate. */
  private spanFrom(start: Token): SourceSpan
  {
    const last = this.tokens[this.pos > 0 ? this.pos - 1 : 0] ?? start;
    return {
      uri: this.uri,
      start: { line: start.line, column: start.column },
      end: { line: last.endLine, column: last.endColumn },
    };
  }

  // ═══════════════════════════ Declaration parsers ═════════════════════════════
  // One method per top-level production. The dispatcher is parseDeclaration; each
  // parse<Thing> assumes its leading keyword is at the cursor (or, for records, its
  // concept identifier is passed in already consumed) and returns a typed AST node.

  /** Parse the file's single wrapper: `namespace <path> { <imports> <decls> }`.
   * Imports come first, then a sequence of declarations. Each declaration is parsed
   * inside a try/catch so a syntax error triggers {@link Parser.synchronize} and the
   * loop continues at the next boundary rather than aborting the whole file. */
  parseNamespace(): NamespaceNode
  {
    const start = this.startToken();
    this.expectKeyword("namespace");
    const path = this.parseDottedPath();
    this.expect(TokenKind.LBrace);

    const imports: string[] = [];
    const importSpans: SourceSpan[] = [];
    while (this.checkKeyword("import"))
    {
      this.advance();
      const startTok = this.current();
      imports.push(this.parseDottedPath());
      importSpans.push(this.spanFrom(startTok));
      this.expect(TokenKind.Semicolon);
    }

    const declarations: Declaration[] = [];
    while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF))
    {
      const before = this.pos; // remembered so we can force progress on a stuck error
      try
      {
        declarations.push(this.parseDeclaration());
      }
      catch (err)
      {
        if (!(err instanceof ParseError)) throw err;
        this.diagnostics.push(this.toDiagnostic(err));
        this.synchronize();
        if (this.pos === before) this.advance(); // guarantee forward progress
      }
    }
    this.expect(TokenKind.RBrace);
    return { path, imports, declarations, span: this.spanFrom(start), importSpans };
  }

  /** Dispatch on the leading keyword to the right declaration parser. `internal` /
   * `sealed` are visibility modifiers that carry no AST meaning here, so they are
   * skipped. A `class`-prefixed or bare identifier heads an instance record; the
   * record's concept may be namespace-qualified, hence parseDottedPath. Anything
   * else is a syntax error (caught by the parseNamespace loop for recovery). */
  private parseDeclaration(): Declaration
  {
    while (this.checkKeyword("internal") || this.checkKeyword("sealed")) this.advance();

    const start = this.startToken();
    if (this.checkKeyword("primitive")) return this.parsePrimitive(start);
    if (this.checkKeyword("taxonomy")) return this.parseTaxonomy(start);
    if (this.checkKeyword("viewpoint")) return this.parseViewpoint(start);
    if (this.checkKeyword("concept")) return this.parseConcept(start);
    if (this.checkKeyword("model")) return this.parseModel(start);
    if (this.checkKeyword("annotation")) return this.parseAnnotation(start);
    if (this.checkKeyword("package")) return this.parsePackage(start);
    if (this.checkKeyword("operator")) return this.parseOperator(start);
    if (this.checkKeyword("class"))
    {
      this.advance(); // class modifier
      return this.parseInstanceFrom(this.expectIdentifier(), start, true);
    }
    if (this.check(TokenKind.Identifier))
    {
      const cStart = this.current();
      const concept = this.parseDottedPath();           // record concept may be ns-qualified
      return this.parseInstanceFrom(concept, start, false, this.spanFrom(cStart));
    }
    throw this.error(`expected a declaration (primitive / enum / concept / instance)`);
  }

  /**
   * Parse an instance record whose leading concept identifier has already been
   * consumed. Body members are either `name = value;` assignments or nested
   * `<concept> <id> { … }` records (containment). An optional `: <meta-model>`
   * binding may follow the id on a container record.
   */
  private parseInstanceFrom(concept: string, start: Token, isClass = false, conceptSpan?: SourceSpan): InstanceDecl
  {
    const idTok = this.expectRecordIdTok();
    const id = idTok.value;
    let instanceOf: string | null = null;
    let instanceOfSpan: SourceSpan | undefined;
    // Optional `<concept> <id> instanceof <class>` — the class this object realizes.
    if (this.checkKeyword("instanceof"))
    {
      this.advance();
      // The class/term may be namespace-qualified; resolution strips the ns.
      const startTok = this.current();
      instanceOf = this.parseDottedPath();
      instanceOfSpan = this.spanFrom(startTok);
    }
    // Optional `: <meta-model>` binding after the id (container records only).
    const binds = this.match(TokenKind.Colon) ? this.expectIdentifier() : null;
    this.expect(TokenKind.LBrace);
    const { assignments, children, annotations, edges } = this.parseRecordBody();
    this.expect(TokenKind.RBrace);
    const decl: InstanceDecl = { kind: DeclKind.Instance, concept, id, binds, isClass, instanceOf, assignments, children, annotations, edges, span: this.spanFrom(start) };
    if (conceptSpan !== undefined) decl.conceptSpan = conceptSpan;
    if (instanceOfSpan !== undefined) decl.instanceOfSpan = instanceOfSpan;
    decl.idSpan = tokenSpan(idTok, this.uri);
    return decl;
  }

  /** Parse a record body (between `{` and `}`, both consumed by the caller):
   * annotate applications, `name = value` assignments, edge applications
   * (`a <glyph> b`), and nested named records. Shared by instance records and
   * inline objects. */
  private parseRecordBody(): {
    assignments: AssignmentNode[];
    children: InstanceDecl[];
    annotations: AnnotationApplication[];
    edges: EdgeApplication[];
  }
  {
    const assignments: AssignmentNode[] = [];
    const children: InstanceDecl[] = [];
    const annotations: AnnotationApplication[] = [];
    const edges: EdgeApplication[] = [];
    while (!this.check(TokenKind.RBrace))
    {
      const memberStart = this.startToken();
      // Order matters: `annotate` and edge applications are recognised first,
      // before the generic identifier branch, since both start with tokens the
      // fallback would otherwise swallow.
      if (this.checkKeyword("annotate")) { annotations.push(this.parseAnnotationApplication(memberStart)); continue; }
      if (this.edgeApplicationAhead()) { edges.push(this.parseEdgeApplication(memberStart)); continue; }
      // A leading identifier is either `name = value;` (assignment, disambiguated
      // by the `=`) or `<concept> <id> { … }` (a nested containment record).
      const first = this.expectIdentifier();
      if (this.match(TokenKind.Equals))
      {
        const value = this.parseValue();
        this.expect(TokenKind.Semicolon);
        assignments.push({ name: first, value, span: this.spanFrom(memberStart) });
      }
      else
      {
        children.push(this.parseInstanceFrom(first, memberStart));
      }
    }
    return { assignments, children, annotations, edges };
  }

  /** True when the tokens ahead form `Identifier ( . Identifier )* {` — a typed
   * inline object, distinct from a bare name value. Lookahead-only: scans past a
   * dotted concept path (without consuming) and checks for the opening `{`. */
  private objectAhead(): boolean
  {
    let i = 0;
    if (this.peekKind(i) !== TokenKind.Identifier) return false;
    i += 1;
    while (this.peekKind(i) === TokenKind.Dot && this.peekKind(i + 1) === TokenKind.Identifier) i += 2;
    return this.peekKind(i) === TokenKind.LBrace;
  }

  /** Parse a typed inline object value `<concept> { <body> }` (used on the RHS of an
   * assignment). Shares parseRecordBody with instance records, so its body admits
   * the same members. Caller has already confirmed the shape via objectAhead. */
  private parseInlineObject(start: Token): ObjectValue
  {
    const cStart = this.current();
    const concept = this.parseDottedPath();
    const conceptSpan = this.spanFrom(cStart);
    this.expect(TokenKind.LBrace);
    const { assignments, children, annotations, edges } = this.parseRecordBody();
    this.expect(TokenKind.RBrace);
    return { kind: ValueKind.Object, concept, assignments, children, annotations, edges, conceptSpan, span: this.spanFrom(start) };
  }

  /**
   * Parse a model: `model <id> : <meta-model> [uses <lib>, …] { <objects> }`.
   * The body reuses instance-record parsing for each contained object.
   */
  private parseModel(start: Token): ModelDecl
  {
    this.expectKeyword("model");
    const idTok = this.expect(TokenKind.Identifier);
    this.expect(TokenKind.Colon);
    // Model bindings are NAMESPACE names, which may be dotted
    // (`libraries.microsoft`, `adl.meta.model`) — accept a dotted path, not a
    // single identifier. A bare name still parses (single-segment path).
    const metaStart = this.current();
    const metaModel = this.parseDottedPath();
    const metaModelSpan = this.spanFrom(metaStart);
    // Optional `uses <lib>, <lib>, …` — the taxonomies this model draws terms from.
    const libraries: string[] = [];
    const librarySpans: SourceSpan[] = [];
    if (this.checkKeyword("uses"))
    {
      this.advance();
      do
      {
        const libStart = this.current();
        libraries.push(this.parseDottedPath());
        librarySpans.push(this.spanFrom(libStart));
      } while (this.match(TokenKind.Comma));
    }
    // Optional `conforms <viewpoint>` — the per-block home viewpoint (required when
    // a model is split across files; see the loader).
    let conforms: string | null = null;
    let conformsSpan: SourceSpan | undefined;
    if (this.checkKeyword("conforms"))
    {
      this.advance();
      const cStart = this.current();
      conforms = this.parseDottedPath();   // viewpoint may be ns-qualified
      conformsSpan = this.spanFrom(cStart);
    }
    const instances: InstanceDecl[] = [];
    const edges: EdgeApplication[] = [];
    const annotations: AnnotationApplication[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace))
    {
      const memberStart = this.startToken();
      if (this.checkKeyword("annotate")) { annotations.push(this.parseAnnotationApplication(memberStart)); continue; }
      if (this.edgeApplicationAhead())
      {
        edges.push(this.parseEdgeApplication(memberStart));
        continue;
      }
      const cStart = this.current();
      const concept = this.parseDottedPath();           // record concept may be ns-qualified
      instances.push(this.parseInstanceFrom(concept, memberStart, false, this.spanFrom(cStart)));
    }
    this.expect(TokenKind.RBrace);
    const decl: ModelDecl = {
      kind: DeclKind.Model,
      id: idTok.value,
      metaModel,
      libraries,
      instances,
      edges,
      annotations,
      conforms,
      span: this.spanFrom(start),
    };
    decl.idSpan = tokenSpan(idTok, this.uri);
    decl.metaModelSpan = metaModelSpan;
    if (librarySpans.length > 0) decl.librarySpans = librarySpans;
    if (conformsSpan !== undefined) decl.conformsSpan = conformsSpan;
    return decl;
  }

  /** `annotation <Name> { <param> : <type><card>; … }` — typed param fields. */
  private parseAnnotation(start: Token): AnnotationDecl
  {
    this.expectKeyword("annotation");
    const nameTok = this.expect(TokenKind.Identifier);
    // Optional base annotation (`annotation Sub : Base`), same `:` supertyping
    // syntax concepts use. The base may be namespace-qualified.
    let extendsName: string | null = null;
    let extendsSpan: SourceSpan | undefined;
    if (this.match(TokenKind.Colon))
    {
      const startTok = this.current();
      extendsName = this.parseDottedPath();
      extendsSpan = this.spanFrom(startTok);
    }
    const params: FieldDecl[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace))
    {
      const pNameTok = this.expect(TokenKind.Identifier);
      this.expect(TokenKind.Colon);
      const typeStart = this.current();
      const typeName = this.parseDottedPath();          // param type may be ns-qualified
      const typeSpan = this.spanFrom(typeStart);
      const cardinality = this.parseCardinality();
      this.expect(TokenKind.Semicolon);
      params.push({
        name: pNameTok.value, type: typeName, cardinality,
        nameSpan: tokenSpan(pNameTok, this.uri), typeSpan,
      });
    }
    this.expect(TokenKind.RBrace);
    const decl: AnnotationDecl = { kind: DeclKind.Annotation, name: nameTok.value, extends: extendsName, params, span: this.spanFrom(start) };
    decl.nameSpan = tokenSpan(nameTok, this.uri);
    if (extendsSpan !== undefined) decl.extendsSpan = extendsSpan;
    return decl;
  }

  /** `annotate <Name> { <param> = <value>; … }` — an application (concept or package body). */
  private parseAnnotationApplication(start: Token): AnnotationApplication
  {
    this.expectKeyword("annotate");
    const nameStart = this.current();
    const name = this.parseDottedPath();                // applied annotation may be ns-qualified
    const nameSpan = this.spanFrom(nameStart);
    const assignments: AssignmentNode[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace))
    {
      const aStart = this.startToken();
      const pName = this.expect(TokenKind.Identifier).value;
      this.expect(TokenKind.Equals);
      const value = this.parseValue();
      this.expect(TokenKind.Semicolon);
      assignments.push({ name: pName, value, span: this.spanFrom(aStart) });
    }
    this.expect(TokenKind.RBrace);
    const app: AnnotationApplication = { name, assignments, span: this.spanFrom(start) };
    app.nameSpan = nameSpan;
    return app;
  }

  /** `package { annotate … }` — a block of package-level applications. */
  private parsePackage(start: Token): PackageDecl
  {
    this.expectKeyword("package");
    const annotations: AnnotationApplication[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace))
    {
      if (!this.checkKeyword("annotate")) throw this.error(`expected "annotate" in a package block`);
      annotations.push(this.parseAnnotationApplication(this.startToken()));
    }
    this.expect(TokenKind.RBrace);
    return { kind: DeclKind.Package, annotations, span: this.spanFrom(start) };
  }

  /** `operator <glyph> : <concept> (<from>, <to>);`  (reified edge) or
   *  `operator <glyph> : <concept>.<relationship>;`   (relationship member). */
  private parseOperator(start: Token): OperatorDecl
  {
    this.expectKeyword("operator");
    const glyphTok = this.expect(TokenKind.SymbolOp);
    this.expect(TokenKind.Colon);
    const conceptStart = this.current();
    const path = this.parseDottedPath();               // `connector` or `component.depends_on`
    let concept = path;
    let relationship: string | null = null;
    let fromMember: string | null = null;
    let toMember: string | null = null;
    if (this.match(TokenKind.LParen)) {                // reified form: (from, to)
      fromMember = this.expectIdentifier();
      this.expect(TokenKind.Comma);
      toMember = this.expectIdentifier();
      this.expect(TokenKind.RParen);
    }
    else {                                           // relationship form: split last segment
      // With no `(from, to)`, the dotted path must be `concept.relationship`; the
      // last `.` splits the concept from its relationship member. A bare, dot-less
      // path is neither form and is an error.
      const dot = path.lastIndexOf(".");
      if (dot < 0) throw this.error(`operator "${glyphTok.value}" needs endpoints "(from, to)" or a "concept.relationship" target`);
      concept = path.slice(0, dot);
      relationship = path.slice(dot + 1);
    }
    this.expect(TokenKind.Semicolon);
    const decl: OperatorDecl = {
      kind: DeclKind.Operator, glyph: glyphTok.value, concept, fromMember, toMember, relationship,
      span: this.spanFrom(start),
    };
    decl.glyphSpan = tokenSpan(glyphTok, this.uri);
    decl.conceptSpan = this.spanFrom(conceptStart);
    return decl;
  }

  /**
   * Parse an edge application STATEMENT `<left> <glyph> <right> [ { … } ] ;`,
   * leading operand NOT yet consumed. The trailing terminator is consumed here
   * (optional after a body, required otherwise). Shape-only: the loader resolves
   * the glyph against the operator table and materializes the edge (design §3).
   */
  private parseEdgeApplication(start: Token): EdgeApplication
  {
    const { edge, sawBody } = this.parseEdgeExpr(start);
    if (sawBody) this.match(TokenKind.Semicolon); // optional trailing `;` after a body
    else this.expect(TokenKind.Semicolon);
    return edge;
  }

  /** Parse the edge core `<left> <glyph> <right> [ { … } ]` WITHOUT a trailing
   * terminator — shared by the statement form (which adds `;`) and the value
   * form (`a ==> b` on the RHS of `=` / in a list, where `;`/`,`/`]` belongs to
   * the enclosing context). `sawBody` records whether a `{ … }` block appeared. */
  private parseEdgeExpr(start: Token): { edge: EdgeApplication; sawBody: boolean }
  {
    const leftStart = this.current();
    const left = this.parseDottedPath();
    const glyphTok = this.expect(TokenKind.SymbolOp);
    const rightStart = this.current();
    const right = this.parseDottedPath();
    const body: AssignmentNode[] = [];
    let sawBody = false;
    if (this.match(TokenKind.LBrace))
    {
      sawBody = true;
      while (!this.check(TokenKind.RBrace))
      {
        const aStart = this.startToken();
        const name = this.expectIdentifier();
        this.expect(TokenKind.Equals);
        const value = this.parseValue();
        this.expect(TokenKind.Semicolon);
        body.push({ name, value, span: this.spanFrom(aStart) });
      }
      this.expect(TokenKind.RBrace);
    }
    const edge: EdgeApplication = { glyph: glyphTok.value, left, right, body, span: this.spanFrom(start) };
    edge.glyphSpan = tokenSpan(glyphTok, this.uri);
    edge.leftSpan = this.spanFrom(leftStart);
    edge.rightSpan = this.spanFrom(rightStart);
    return { edge, sawBody };
  }

  /** True when the tokens ahead form `Identifier ( . Identifier )*` immediately
   * followed by a SymbolOp — an edge application `a <glyph> b`. The one lookahead
   * that lets a record body / value position tell an edge apart from a plain name:
   * both start with a (dotted) identifier, but only an edge has a trailing SymbolOp. */
  private edgeApplicationAhead(): boolean
  {
    let i = 0;
    if (this.peekKind(i) !== TokenKind.Identifier) return false;
    i += 1;
    while (this.peekKind(i) === TokenKind.Dot && this.peekKind(i + 1) === TokenKind.Identifier) i += 2;
    return this.peekKind(i) === TokenKind.SymbolOp;
  }

  // ══════════════════════════════ Value parsers ════════════════════════════════

  /** Parse a single value on the RHS of an assignment (or a list item). Dispatches
   * on the leading token(s) to one of the {@link ValueKind} forms. The order of the
   * checks encodes precedence between forms that share a prefix — an edge (`a ==> b`)
   * and an inline object (`c { … }`) are both tried BEFORE a plain identifier name,
   * since a bare name is the fallthrough. Numbers are kept as String values (TODL
   * has no distinct numeric value kind at this layer). */
  private parseValue(): ValueNode
  {
    if (this.edgeApplicationAhead())
    {
      return { kind: ValueKind.Edge, edge: this.parseEdgeExpr(this.startToken()).edge };
    }
    if (this.check(TokenKind.Identifier) && this.objectAhead())
    {
      return this.parseInlineObject(this.startToken());
    }
    if (this.check(TokenKind.String) || this.check(TokenKind.RawString))
    {
      return { kind: ValueKind.String, text: this.advance().value };
    }
    if (this.check(TokenKind.Number))
    {
      return { kind: ValueKind.String, text: this.advance().value };
    }
    // `[ v, v, … ]` — a list value; each item is a full nested value (so lists may
    // hold names, objects, edges…). A trailing comma before `]` is tolerated.
    if (this.match(TokenKind.LBracket))
    {
      const items: ValueNode[] = [];
      if (!this.check(TokenKind.RBracket))
      {
        items.push(this.parseValue());
        while (this.match(TokenKind.Comma))
        {
          if (this.check(TokenKind.RBracket)) break; // trailing comma
          items.push(this.parseValue());
        }
      }
      this.expect(TokenKind.RBracket);
      return { kind: ValueKind.List, items };
    }
    if (this.check(TokenKind.Identifier))
    {
      // `true` / `false` are reserved boolean literals — a bare one is always a
      // boolean value (not a name/relationship). A dotted or `|`-composed use
      // (`x.true`, `a | true`) keeps the identifier path below.
      const word = this.current().value;
      if ((word === "true" || word === "false")
          && this.peekKind(1) !== TokenKind.Dot && this.peekKind(1) !== TokenKind.Pipe)
          {
        this.advance();
        return { kind: ValueKind.Boolean, value: word === "true" };
      }
      const startTok = this.current();
      const first = this.advance().value;
      // `a | b | c` — a composite: a `|`-joined set of names (enum flags, or a
      // multi-term selection the loader turns into one edge per part).
      if (this.check(TokenKind.Pipe))
      {
        const parts = [first];
        while (this.match(TokenKind.Pipe)) parts.push(this.expectIdentifier());
        return { kind: ValueKind.Composite, parts };
      }
      if (this.check(TokenKind.Dot))
      {
        // A dotted bare name — a taxonomy-qualified term ref (`taxonomy.term`).
        const parts = [first];
        while (this.match(TokenKind.Dot)) parts.push(this.expectIdentifier());
        return { kind: ValueKind.Name, name: parts.join("."), span: this.spanFrom(startTok) };
      }
      return { kind: ValueKind.Name, name: first, span: this.spanFrom(startTok) };
    }
    throw this.error(`expected a value`);
  }

  /** `primitive <name> [: <base>] { description = "…"; regex = "…"; }` — a scalar
   * value type. The body holds only the recognised string members; the loop reads
   * generic `key = value;` members and keeps the two it knows. */
  private parsePrimitive(start: Token): PrimitiveDecl
  {
    this.expectKeyword("primitive");
    const nameTok = this.expect(TokenKind.Identifier);
    const name = nameTok.value;
    const base = this.match(TokenKind.Colon) ? this.expectIdentifier() : null;

    let description = "";
    let regex: string | null = null;
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace))
    {
      const [key, value] = this.readStringMember();
      if (key === "description") description = value ?? "";
      else if (key === "regex") regex = value;
    }
    this.expect(TokenKind.RBrace);
    const decl: PrimitiveDecl = { kind: DeclKind.Primitive, name, base, description, regex, span: this.spanFrom(start) };
    decl.nameSpan = tokenSpan(nameTok, this.uri);
    return decl;
  }

  /** `taxonomy <name> : represents <concept>, … [uses <tax>, …] { <terms> }` — a
   * hierarchy of terms classifying the represented concept(s). The header lists the
   * concepts it represents and the sibling taxonomies it may draw bare refs from;
   * the body mixes term rows, taxonomy-level `annotate`s, and a `description`. */
  private parseTaxonomy(start: Token): TaxonomyDecl
  {
    this.expectKeyword("taxonomy");
    const nameTok = this.expect(TokenKind.Identifier);
    const name = nameTok.value;
    this.expect(TokenKind.Colon);
    this.expectKeyword("represents");
    const represents: string[] = [];
    const representsSpans: SourceSpan[] = [];
    // represents / uses targets may be namespace-qualified (`ns.concept`,
    // `ns.taxonomy`); resolution strips the namespace prefix. parseDottedPath
    // accepts a bare name too, so unqualified authoring is unchanged.
    const pushTarget = (): void => {
      const startTok = this.current();
      represents.push(this.parseDottedPath());
      representsSpans.push(this.spanFrom(startTok));
    };
    pushTarget();
    while (this.match(TokenKind.Comma)) pushTarget();
    const uses: string[] = [];
    const usesSpans: SourceSpan[] = [];
    if (this.checkKeyword("uses"))
    {
      this.advance();
      do
      {
        const startTok = this.current();
        uses.push(this.parseDottedPath());
        usesSpans.push(this.spanFrom(startTok));
      } while (this.match(TokenKind.Comma));
    }
    let description = "";
    const terms: Term[] = [];
    const annotations: AnnotationApplication[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace))
    {
      // Checked before tryParseTerm: `annotate` lexes as an identifier, so
      // `annotate icon {` would otherwise match the concept-led-term lookahead
      // (`<identifier> <identifier> {`) and be mis-parsed as a term.
      if (this.checkKeyword("annotate"))
      {
        annotations.push(this.parseAnnotationApplication(this.startToken()));
        continue;
      }
      const term = this.tryParseTerm();
      if (term !== null)
      {
        terms.push(term);
      }
      else
      {
        const [key, value] = this.readStringMember();
        if (key === "description" && value !== null) description = value;
      }
    }
    this.expect(TokenKind.RBrace);
    const decl: TaxonomyDecl = { kind: DeclKind.Taxonomy, name, represents, representsSpans, description, terms, annotations, uses, span: this.spanFrom(start) };
    decl.nameSpan = tokenSpan(nameTok, this.uri);
    if (usesSpans.length > 0) decl.usesSpans = usesSpans;
    return decl;
  }

  /** `viewpoint <name> : frames <Concept>, …;` — a named lens over the concepts it
   * frames. Header-only: there is no body block, so the declaration ends at the
   * frame list (no trailing `;`/`}` is consumed here; the caller's loop moves on). */
  private parseViewpoint(start: Token): ViewpointDecl
  {
    this.expectKeyword("viewpoint");
    const nameTok = this.expect(TokenKind.Identifier);
    const name = nameTok.value;
    this.expect(TokenKind.Colon);
    this.expectKeyword("frames");
    const frames: string[] = [];
    const framesSpans: SourceSpan[] = [];
    // frames targets may be namespace-qualified (`ns.Concept`); parseDottedPath
    // accepts a bare name too, so unqualified authoring is unchanged.
    const pushTarget = (): void => {
      const startTok = this.current();
      frames.push(this.parseDottedPath());
      framesSpans.push(this.spanFrom(startTok));
    };
    pushTarget();
    while (this.match(TokenKind.Comma)) pushTarget();
    // No body block — a viewpoint has no terms; the declaration ends here.
    const decl: ViewpointDecl = { kind: DeclKind.Viewpoint, name, frames, framesSpans, span: this.spanFrom(start) };
    decl.nameSpan = tokenSpan(nameTok, this.uri);
    return decl;
  }

  /**
   * A term at the head of the cursor, or `null` if the next member is not a term
   * (e.g. a `description = "…"` assignment). Two forms:
   *   - `term <id> { … }`            — the single-concept alias (concept = null)
   *   - `<concept> <id> { … }`       — concept-led (a class of `<concept>`)
   * The concept-led form is recognised by `<identifier> <identifier> {`.
   */
  private tryParseTerm(): Term | null
  {
    if (this.checkKeyword("term")) return this.parseTerm(null);
    if (this.check(TokenKind.Identifier) && this.peekKind(1) === TokenKind.Identifier)
    {
      const concept = this.expectIdentifier();
      return this.parseTerm(concept);
    }
    return null;
  }

  // Parse a term row (the leading `term` keyword or `<concept>` is already
  // consumed; `concept` is null for the `term` alias). A term is a class of its
  // concept: its body mixes `name = value;` assignments (its fixed field values)
  // and nested term rows, distinguished from assignments by the same lookahead
  // at every depth.
  private parseTerm(concept: string | null): Term
  {
    const start = this.startToken();
    if (concept === null) this.expectKeyword("term");
    const idTok = this.expect(TokenKind.Identifier);
    const id = idTok.value;
    const assignments: AssignmentNode[] = [];
    const children: Term[] = [];
    const annotations: AnnotationApplication[] = [];
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace))
    {
      if (this.checkKeyword("annotate"))
      {
        annotations.push(this.parseAnnotationApplication(this.startToken()));
        continue;
      }
      const child = this.tryParseTerm();
      if (child !== null)
      {
        children.push(child);
      }
      else
      {
        const memberStart = this.startToken();
        const name = this.expectIdentifier();
        this.expect(TokenKind.Equals);
        const value = this.parseValue();
        this.expect(TokenKind.Semicolon);
        assignments.push({ name, value, span: this.spanFrom(memberStart) });
      }
    }
    this.expect(TokenKind.RBrace);
    const term: Term = { id, concept, assignments, children, annotations, span: this.spanFrom(start) };
    term.idSpan = tokenSpan(idTok, this.uri);
    return term;
  }

  /** `concept <Name> [: <parent>] { <members> }` — a type. The body mixes several
   * member kinds, each recognised by a leading keyword: `relationship` (a `->`
   * edge member), `invariant` (a predicate), `annotate` (an application), and the
   * doc-only `authoring` block (skipped). A bare identifier is either a `:` typed
   * FIELD or a `=` doc assignment (only `description` is kept). */
  private parseConcept(start: Token): ConceptDecl
  {
    this.expectKeyword("concept");
    const nameTok = this.expect(TokenKind.Identifier);
    const name = nameTok.value;
    let extendsName: string | null = null;
    let extendsSpan: SourceSpan | undefined;
    if (this.match(TokenKind.Colon))
    {
      // A parent may be namespace-qualified (`ns.concept`); resolution strips
      // the namespace. Bare names still parse.
      const startTok = this.current();
      extendsName = this.parseDottedPath();
      extendsSpan = this.spanFrom(startTok);
    }

    let description = "";
    const fields: FieldDecl[] = [];
    const relationships: RelationshipDecl[] = [];
    const invariants: InvariantDecl[] = [];
    const annotations: AnnotationApplication[] = [];

    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace))
    {
      if (this.checkKeyword("relationship"))
      {
        relationships.push(this.parseRelationship());
      }
      else if (this.checkKeyword("invariant"))
      {
        invariants.push(this.parseInvariant());
      }
      else if (this.checkKeyword("annotate"))
      {
        annotations.push(this.parseAnnotationApplication(this.startToken()));
      }
      else if (this.checkKeyword("authoring"))
      {
        // Doc-only authoring-form blocks (`authoring list-form { … }`) carry no
        // schema; skip them.
        this.advance();
        this.expectIdentifier();
        this.skipBracedBlock();
      }
      else
      {
        const nameTok = this.expect(TokenKind.Identifier);
        const memberName = nameTok.value;
        if (this.match(TokenKind.Colon))
        {
          const typeStart = this.current();
          const typeName = this.parseDottedPath();      // field type may be ns-qualified
          const typeSpan = this.spanFrom(typeStart);
          const cardinality = this.parseCardinality();
          this.expect(TokenKind.Semicolon);
          fields.push({
            name: memberName, type: typeName, cardinality,
            nameSpan: tokenSpan(nameTok, this.uri), typeSpan,
          });
        }
        else if (this.match(TokenKind.Equals))
        {
          if (this.check(TokenKind.String) || this.check(TokenKind.RawString))
          {
            const value = this.parseStringValue();
            if (memberName === "description") description = value;
          }
          else
          {
            // Doc-only non-string members (`references = [ … ]`); skip.
            this.skipToSemicolon();
          }
          this.expect(TokenKind.Semicolon);
        }
        else
        {
          throw this.error(`expected ":" (field) or "=" (assignment) after "${memberName}"`);
        }
      }
    }
    this.expect(TokenKind.RBrace);
    const decl: ConceptDecl = { kind: DeclKind.Concept, name, extends: extendsName, description, fields, relationships, invariants, annotations, span: this.spanFrom(start) };
    if (extendsSpan !== undefined) decl.extendsSpan = extendsSpan;
    decl.nameSpan = tokenSpan(nameTok, this.uri);
    return decl;
  }

  /** `relationship <name> -> <target> [| <target>…] <card> [{ annotate … } | ;]` —
   * an edge member. The `|`-separated target list is a union of allowed concepts.
   * A relationship may carry an annotate-only body, otherwise it ends in `;`. */
  private parseRelationship(): RelationshipDecl
  {
    this.expectKeyword("relationship");
    const nameTok = this.expect(TokenKind.Identifier);
    this.expectSymbol("->");
    const targetStart = this.current();
    const targets = [this.parseDottedPath()];           // relationship target may be ns-qualified
    const targetSpans = [this.spanFrom(targetStart)];
    while (this.match(TokenKind.Pipe)) {                 // `-> a | b | c` union of target concepts
      const nextStart = this.current();
      targets.push(this.parseDottedPath());
      targetSpans.push(this.spanFrom(nextStart));
    }
    const cardinality = this.parseCardinality();
    const annotations: AnnotationApplication[] = [];
    if (this.match(TokenKind.LBrace))
    {
      while (!this.check(TokenKind.RBrace))
      {
        if (this.checkKeyword("annotate"))
        {
          annotations.push(this.parseAnnotationApplication(this.startToken()));
        }
        else
        {
          throw this.error('only "annotate" statements are allowed in a relationship body');
        }
      }
      this.expect(TokenKind.RBrace);
    }
    else
    {
      this.expect(TokenKind.Semicolon);
    }
    return {
      name: nameTok.value, targets, cardinality, annotations,
      nameSpan: tokenSpan(nameTok, this.uri), targetSpans,
    };
  }

  /** Parse an `invariant`. Two forms: a bare `invariant "<description>";`
   * (documentation only, no predicate), or a block `invariant { predicate = …;
   * description = "…"; }`. The `predicate` value is NOT parsed here — its raw token
   * slice is captured (see collectUntilSemicolon) and handed to the dedicated
   * predicate parser later by the loader. */
  private parseInvariant(): InvariantDecl
  {
    this.expectKeyword("invariant");
    if (this.check(TokenKind.String) || this.check(TokenKind.RawString))
    {
      const description = this.parseStringValue();
      this.expect(TokenKind.Semicolon);
      return { description, predicate: null };
    }

    let description = "";
    let predicate: Token[] | null = null;
    this.expect(TokenKind.LBrace);
    while (!this.check(TokenKind.RBrace))
    {
      const key = this.expectIdentifier();
      this.expect(TokenKind.Equals);
      if (key === "predicate")
      {
        predicate = this.collectUntilSemicolon();
        this.expect(TokenKind.Semicolon);
      }
      else
      {
        const value = this.parseStringValue();
        this.expect(TokenKind.Semicolon);
        if (key === "description") description = value;
      }
    }
    this.expect(TokenKind.RBrace);
    return { description, predicate };
  }

  // ════════════════════════ Small parsers & token utilities ════════════════════

  /** Read an optional cardinality suffix on a member type: `?` → Optional, `[]` →
   * Many, `[+]` → OneOrMore. Nothing → the default One (exactly one). */
  private parseCardinality(): Cardinality
  {
    if (this.match(TokenKind.Question)) return Cardinality.Optional;
    if (this.check(TokenKind.LBracket))
    {
      this.advance();
      if (this.match(TokenKind.Plus))
      {
        this.expect(TokenKind.RBracket);
        return Cardinality.OneOrMore;
      }
      this.expect(TokenKind.RBracket);
      return Cardinality.Many;
    }
    return Cardinality.One;
  }

  /** Read a dotted name `a.b.c` and return it joined with `.`. Accepts a single
   * bare identifier (a one-segment path), so every namespace-qualifiable position
   * can call this uniformly whether or not the author qualified the name. */
  private parseDottedPath(): string
  {
    const parts = [this.expectIdentifier()];
    while (this.match(TokenKind.Dot))
    {
      parts.push(this.expectIdentifier());
    }
    return parts.join(".");
  }

  /** Expect and consume a string (or raw-string) literal, returning its text. */
  private parseStringValue(): string
  {
    if (this.check(TokenKind.String) || this.check(TokenKind.RawString))
    {
      return this.advance().value;
    }
    throw this.error(`expected a string value`);
  }

  /**
   * Read a `key = <value>;` member. String/number values are returned; any
   * other value (a doc-only `references = [ … ]` list) is skipped and returned
   * as `null`, so callers ignore members they don't recognise.
   */
  private readStringMember(): [string, string | null]
  {
    const key = this.expectIdentifier();
    this.expect(TokenKind.Equals);
    let value: string | null = null;
    if (this.check(TokenKind.String) || this.check(TokenKind.RawString) || this.check(TokenKind.Number))
    {
      value = this.advance().value;
    }
    else
    {
      this.skipToSemicolon();
    }
    this.expect(TokenKind.Semicolon);
    return [key, value];
  }

  /** Skip a balanced `{ … }` block (raw strings are single tokens, so brace-safe). */
  private skipBracedBlock(): void
  {
    this.expect(TokenKind.LBrace);
    let depth = 1;
    while (depth > 0 && !this.check(TokenKind.EOF))
    {
      if (this.check(TokenKind.LBrace)) depth += 1;
      else if (this.check(TokenKind.RBrace)) depth -= 1;
      this.advance();
    }
  }

  /** Advance to (but not past) the next `;`. */
  private skipToSemicolon(): void
  {
    while (!this.check(TokenKind.Semicolon) && !this.check(TokenKind.EOF)) this.advance();
  }

  /** Consume tokens up to (not past) the next `;` and return them as a raw slice.
   * Used to capture an invariant `predicate = …` verbatim for the predicate parser,
   * so this parser never has to understand predicate grammar. */
  private collectUntilSemicolon(): Token[]
  {
    const start = this.pos;
    while (!this.check(TokenKind.Semicolon) && !this.check(TokenKind.EOF)) this.advance();
    return this.tokens.slice(start, this.pos);
  }

  // ── Cursor helpers ────────────────────────────────────────────────────────
  // The read layer over `tokens`/`pos`. `check*` inspect without moving; `match*`
  // consume only on a match (returning whether they did); `expect*` consume or
  // throw a ParseError. Everything above is written in terms of these.

  /** The token at the cursor. Past the end, returns the last token (an EOF token),
   * never undefined, so callers never need a null check. */
  private current(): Token
  {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1] ?? EOF_TOKEN;
  }

  /** True when the current token is of `kind` (no consumption). */
  private check(kind: TokenKind): boolean
  {
    return this.current().kind === kind;
  }

  /** The kind of the token `offset` positions ahead of the cursor — the lookahead
   * primitive the `*Ahead` predicates are built on. Past the end reads as EOF. */
  private peekKind(offset: number): TokenKind
  {
    return (this.tokens[this.pos + offset] ?? EOF_TOKEN).kind;
  }

  /** True when the current token is the identifier `word`. Keywords in TODL are not
   * a distinct token kind — they lex as identifiers and are recognised by value. */
  private checkKeyword(word: string): boolean
  {
    const token = this.current();
    return token.kind === TokenKind.Identifier && token.value === word;
  }

  /** True when the current token is a SymbolOp with exactly `value`. */
  private checkSymbol(value: string): boolean
  {
    const t = this.current();
    return t.kind === TokenKind.SymbolOp && t.value === value;
  }

  /** Consume the current token if it is the SymbolOp `value`; report whether it was. */
  private matchSymbol(value: string): boolean
  {
    if (this.checkSymbol(value))
    {
      this.advance();
      return true;
    }
    return false;
  }

  /** Consume the SymbolOp `value` or throw. */
  private expectSymbol(value: string): Token
  {
    if (!this.checkSymbol(value)) throw this.error(`expected "${value}"`);
    return this.advance();
  }

  /** Consume the current token if it is of `kind`; report whether it was. */
  private match(kind: TokenKind): boolean
  {
    if (this.check(kind))
    {
      this.advance();
      return true;
    }
    return false;
  }

  /** Return the current token and step the cursor forward. Clamps at the last token
   * (the EOF sentinel), so advancing at end-of-input is a harmless no-move. */
  private advance(): Token
  {
    const token = this.current();
    if (this.pos < this.tokens.length - 1) this.pos += 1;
    return token;
  }

  /** Consume the current token, requiring it to be of `kind`, or throw a ParseError. */
  private expect(kind: TokenKind): Token
  {
    if (!this.check(kind)) throw this.error(`expected "${kind}"`);
    return this.advance();
  }

  /** Consume the keyword `word` or throw. */
  private expectKeyword(word: string): Token
  {
    if (!this.checkKeyword(word)) throw this.error(`expected "${word}"`);
    return this.advance();
  }

  /** Consume an identifier and return its text, or throw. */
  private expectIdentifier(): string
  {
    return this.expect(TokenKind.Identifier).value;
  }

  /** A record id token — a bare identifier or a quoted string (e.g. `sequence "…"`). */
  private expectRecordIdTok(): Token
  {
    if (this.check(TokenKind.String) || this.check(TokenKind.RawString))
    {
      return this.advance();
    }
    return this.expect(TokenKind.Identifier);
  }

  /** Build a {@link ParseError} at the current token, appending its line:column and
   * the offending lexeme to `message`. The token is carried so the catch sites can
   * span the diagnostic precisely. */
  private error(message: string): ParseError
  {
    const token = this.current();
    const got = token.value.length > 0 ? token.value : token.kind;
    return new ParseError(`${message} at ${token.line}:${token.column} (got "${got}")`, token);
  }
}

/** Sentinel returned by the cursor helpers when they read past the token stream,
 * so `current()`/`peekKind()` always yield a real token instead of undefined. */
const EOF_TOKEN: Token = { kind: TokenKind.EOF, value: "", line: 0, column: 0, endLine: 0, endColumn: 0 };
