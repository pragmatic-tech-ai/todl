/**
 * Lexer for the TODL surface (design spec §3, legacy `adl/todl/spec.md` §2) — the
 * very first stage of the compiler pipeline: it turns a flat run of source
 * characters into a flat array of {@link Token}s that the parser then reads.
 *
 *   source text ──▶ [ LEXER ] ──▶ tokens ──▶ parser ──▶ loader ──▶ Repository graph
 *
 * ─────────────────────────────── What it recognises ────────────────────────────
 *   • Identifiers  — C-like `[A-Za-z_][A-Za-z0-9_]*` (keywords are NOT special to
 *     the lexer; they are just identifiers that the parser interprets).
 *   • Numbers      — integer or decimal (`42`, `3.14`).
 *   • Strings      — double-quoted with `\n \t \r \" \\` escapes.
 *   • Raw strings  — triple-quoted (`"""…"""`), verbatim except that common
 *     leading indentation is stripped (handy for multi-line doc text).
 *   • Punctuation  — braces / brackets / parens, `; , : = | & ? + * .` and the
 *     `[]` / `[+]` cardinality markers the parser assembles from `[` `]` `+`.
 *   • Operator glyphs — a maximal run of "edge" characters (`- ~ = > < !`) becomes
 *     ONE {@link TokenKind.SymbolOp}, covering both author-defined edge operators
 *     (`~>`, `==>`, `->`) and predicate operators (`==`, `!=`). A lone `=` is the
 *     exception: it is assignment, not a SymbolOp.
 *
 * ──────────────────────────────── Trivia & errors ──────────────────────────────
 * Whitespace and `//` line / `/* *​/` block comments are trivia — silently
 * skipped, never emitted as tokens. Unknown characters (notably `$` and `@`,
 * which are reserved for the downstream Mural layer) fail loud: they produce a
 * diagnostic with precise line:column and are then skipped so scanning can
 * continue and report further problems in one pass.
 *
 * ───────────────────────────────── How it scans ────────────────────────────────
 * The {@link Lexer} is a single left-to-right cursor (`pos`) that also tracks the
 * human-facing 1-based `line`/`column` for spans. {@link Lexer.scan} loops:
 * skip trivia, then dispatch on the next character to a specialised reader. It is
 * a hand-written scanner (no regex engine) so every token carries an exact source
 * span and lexing errors recover gracefully instead of aborting.
 *
 * Two entry points: {@link tokenize} (tokens only, anonymous source) and
 * {@link lex} (tokens + collected diagnostics, with a real file uri for spans).
 */

import { type Diagnostic, DiagnosticCode, Severity } from "../diagnostics/diagnostic.js";

// ═══════════════════════════════════════════════════════════════════════════════
// TOKENS — the vocabulary produced by the lexer and consumed by the parser
// ═══════════════════════════════════════════════════════════════════════════════

/** The kinds of token the lexer can emit. The string value of each member is the
 * literal glyph it represents (where applicable), which keeps debugging output
 * readable and lets the parser compare against the character it expects. */

export enum TokenKind {
  Identifier = "identifier",
  String = "string",
  RawString = "raw-string",
  Number = "number",
  LBrace = "{",
  RBrace = "}",
  LBracket = "[",
  RBracket = "]",
  LParen = "(",
  RParen = ")",
  Semicolon = ";",
  Comma = ",",
  Colon = ":",
  Equals = "=",
  /** A maximal run of edge characters (`- ~ = > < !`) — an author-defined
   * operator glyph (`~>`, `==>`, `->`) or a predicate operator (`==`, `!=`). */
  SymbolOp = "symbol-op",
  Pipe = "|",
  Amp = "&",
  Question = "?",
  Plus = "+",
  Star = "*",
  Dot = ".",
  And = "&&",
  Or = "||",
  EOF = "eof",
}

/** A single lexical token. `value` is the raw matched text (already unescaped for
 * strings, already indent-stripped for raw strings). The `line`/`column` pair
 * marks where the token STARTS and `endLine`/`endColumn` where it ENDS — all
 * 1-based — so downstream stages can build precise diagnostic spans. */
export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ENTRY POINTS
// ═══════════════════════════════════════════════════════════════════════════════

/** Tokenize `source` with no file identity, discarding any diagnostics. Convenient
 * for tests and callers that only care about the token stream of valid input. */
export function tokenize(source: string): Token[] {
  return new Lexer(source, "<anonymous>").scan();
}

/** Tokenize `source` belonging to `uri`, returning both the tokens AND every
 * diagnostic gathered while scanning. This is the form the real pipeline uses:
 * the `uri` flows into each token's span so errors point at the right file. */
export function lex(source: string, uri: string): { tokens: Token[]; diagnostics: Diagnostic[] } {
  const lexer = new Lexer(source, uri);
  const tokens = lexer.scan();
  return { tokens, diagnostics: lexer.diagnostics };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHARACTER TABLES — static lookups shared by every Lexer instance
// ═══════════════════════════════════════════════════════════════════════════════

/** Characters that compose an author-defined operator glyph (design §2). A
 * maximal run of these becomes one SymbolOp token; a lone "=" is assignment. */
const EDGE_CHARS: ReadonlySet<string> = new Set(["-", "~", "=", ">", "<", "!"]);

/** Characters that map one-to-one to a token kind with no context needed. When
 * the operator reader sees one of these, it emits the corresponding single-char
 * token immediately. (`&`, `|`, and the edge chars are handled separately because
 * they can also begin a longer token like `&&`, `||`, or a SymbolOp run.) */
const SINGLE_CHAR: ReadonlyMap<string, TokenKind> = new Map([
  ["{", TokenKind.LBrace],
  ["}", TokenKind.RBrace],
  ["[", TokenKind.LBracket],
  ["]", TokenKind.RBracket],
  ["(", TokenKind.LParen],
  [")", TokenKind.RParen],
  [";", TokenKind.Semicolon],
  [",", TokenKind.Comma],
  [":", TokenKind.Colon],
  ["?", TokenKind.Question],
  ["+", TokenKind.Plus],
  ["*", TokenKind.Star],
  [".", TokenKind.Dot],
]);

// ═══════════════════════════════════════════════════════════════════════════════
// THE LEXER — a stateful single-pass cursor over the source string
// ═══════════════════════════════════════════════════════════════════════════════

class Lexer {
  /** Absolute index of the cursor into `source`. */
  private pos = 0;
  /** 1-based line at the cursor (advanced on every `\n`). */
  private line = 1;
  /** 1-based column at the cursor (reset to 1 after each `\n`). */
  private column = 1;
  /** Tokens accumulated so far, in source order. */
  private readonly tokens: Token[] = [];
  /** Non-fatal problems found while scanning; surfaced to the caller via {@link lex}. */
  readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly source: string, private readonly uri: string) {}

  /** Record a lexing error as a single-line span from `column` to `endColumn`.
   * Errors never throw — the scanner keeps going so one pass finds many problems. */
  private report(code: DiagnosticCode, message: string, line: number, column: number, endColumn: number): void {
    this.diagnostics.push({
      code,
      severity: Severity.Error,
      message,
      span: { uri: this.uri, start: { line, column }, end: { line, column: endColumn } },
      node: null,
      path: null,
    });
  }

  /** The main loop. Repeatedly: drop leading trivia, capture the start position,
   * then dispatch on the first character to the reader for that token family.
   * Terminates with an explicit EOF token so the parser always has a sentinel. */
  scan(): Token[] {
    for (;;) {
      this.skipTrivia();
      if (this.pos >= this.source.length) break;

      // Remember where this token begins BEFORE any reader advances the cursor,
      // so the emitted token spans from here to wherever the reader stops.
      const line = this.line;
      const column = this.column;
      const char = this.peek();

      if (isIdentifierStart(char)) {
        const value = this.readIdentifier();
        this.tokens.push({ kind: TokenKind.Identifier, value, line, column, endLine: this.line, endColumn: this.column });
        continue;
      }
      if (isDigit(char)) {
        const value = this.readNumber();
        this.tokens.push({ kind: TokenKind.Number, value, line, column, endLine: this.line, endColumn: this.column });
        continue;
      }
      if (char === '"') {
        this.readStringLike(line, column);
        continue;
      }
      // Anything that isn't an identifier, number, or string is punctuation or an
      // operator glyph — or, if unrecognised, an error the operator reader reports.
      this.readOperator(line, column);
    }

    this.tokens.push({ kind: TokenKind.EOF, value: "", line: this.line, column: this.column, endLine: this.line, endColumn: this.column });
    return this.tokens;
  }

  // ── operators & punctuation ──
  /** Read whatever punctuation / operator begins at the cursor. Ordering matters:
   * longer / greedier matches are tried before shorter ones. */
  private readOperator(line: number, column: number): void {
    const char = this.peek();

    // A maximal run of edge characters is one SymbolOp — an operator glyph or a
    // predicate operator (`==`, `!=`). A lone `=` is assignment, not a SymbolOp.
    if (EDGE_CHARS.has(char)) {
      let run = "";
      while (EDGE_CHARS.has(this.peek())) {
        run += this.peek();
        this.advance();
      }
      const kind = run === "=" ? TokenKind.Equals : TokenKind.SymbolOp;
      this.tokens.push({ kind, value: run, line, column, endLine: this.line, endColumn: this.column });
      return;
    }

    // Two-character logical operators must be matched before the single-char `&`
    // / `|` fallbacks below, otherwise `&&` would lex as two `Amp` tokens.
    const two = char + this.peek(1);
    if (two === "&&") return this.push(TokenKind.And, "&&", line, column, 2);
    if (two === "||") return this.push(TokenKind.Or, "||", line, column, 2);

    // Unambiguous single characters from the table.
    const single = SINGLE_CHAR.get(char);
    if (single !== undefined) return this.push(single, char, line, column, 1);
    // Lone `&` (reference sigil) / `|` (union), i.e. not part of `&&` / `||`.
    if (char === "&") return this.push(TokenKind.Amp, "&", line, column, 1);
    if (char === "|") return this.push(TokenKind.Pipe, "|", line, column, 1);

    // Nothing matched — reserved or stray character (e.g. `$`, `@`). Report and
    // skip it so scanning continues rather than stalling on the same char.
    this.report(DiagnosticCode.UnexpectedCharacter, `unexpected character "${char}"`, line, column, column + 1);
    this.advance(); // skip the offending character and continue
  }

  // ── string literals ──
  /** Decide between a triple-quoted raw string (`"""`) and a plain string by
   * looking two characters ahead; the caller already knows the cursor is on `"`. */
  private readStringLike(line: number, column: number): void {
    if (this.peek(1) === '"' && this.peek(2) === '"') {
      this.push(TokenKind.RawString, this.readRawString(), line, column, 0);
    } else {
      this.push(TokenKind.String, this.readString(line, column), line, column, 0);
    }
  }

  // ── identifiers & numbers ──
  /** Consume an identifier: one start char followed by zero or more part chars.
   * Returns the raw text; the caller wraps it in an Identifier token. */
  private readIdentifier(): string {
    const start = this.pos;
    this.advance();
    for (;;) {
      const char = this.peek();
      if (isIdentifierPart(char)) {
        this.advance();
      } else {
        break;
      }
    }
    return this.source.slice(start, this.pos);
  }

  /** Consume an integer, optionally followed by a fractional part. The fraction is
   * only taken when the `.` is FOLLOWED by a digit, so `1.foo` lexes as the number
   * `1` then the `.` operator then `foo` — the dot is not swallowed spuriously. */
  private readNumber(): string {
    const start = this.pos;
    while (isDigit(this.peek())) this.advance();
    if (this.peek() === "." && isDigit(this.peek(1))) {
      this.advance();
      while (isDigit(this.peek())) this.advance();
    }
    return this.source.slice(start, this.pos);
  }

  /** Consume a double-quoted string, decoding backslash escapes as it goes.
   * Recovers from an unterminated string (newline or EOF before the closing `"`)
   * by reporting and returning what it has WITHOUT consuming the newline/EOF, so
   * the outer loop can resume cleanly on the next line. */
  private readString(line: number, column: number): string {
    this.advance(); // opening quote
    let value = "";
    while (this.peek() !== '"') {
      if (this.pos >= this.source.length || this.peek() === "\n") {
        this.report(DiagnosticCode.UnterminatedString, "unterminated string", line, column, this.column);
        return value; // recover: emit the partial string, do not consume the newline/EOF
      }
      if (this.peek() === "\\") {
        this.advance();
        value += unescape(this.peek());
        this.advance();
      } else {
        value += this.peek();
        this.advance();
      }
    }
    this.advance(); // closing quote
    return value;
  }

  /** Consume a triple-quoted raw string: no escape processing, everything between
   * the delimiters is verbatim, then common leading indentation is stripped (see
   * {@link stripCommonIndent}) so indented multi-line blocks read naturally.
   * Recovers from a missing closing `"""` the same way as {@link readString}. */
  private readRawString(): string {
    this.advance();
    this.advance();
    this.advance(); // opening """
    const start = this.pos;
    while (!(this.peek() === '"' && this.peek(1) === '"' && this.peek(2) === '"')) {
      if (this.pos >= this.source.length) {
        this.report(DiagnosticCode.UnterminatedString, "unterminated raw string", this.line, this.column, this.column);
        return stripCommonIndent(this.source.slice(start, this.pos));
      }
      this.advance();
    }
    const raw = this.source.slice(start, this.pos);
    this.advance();
    this.advance();
    this.advance(); // closing """
    return stripCommonIndent(raw);
  }

  // ── trivia & cursor primitives ──
  /** Skip everything the parser never sees: whitespace, `//` line comments (to end
   * of line, leaving the `\n` for the next iteration), and `/* … *​/` block
   * comments. Loops until the cursor sits on a real token character or EOF. */
  private skipTrivia(): void {
    for (;;) {
      const char = this.peek();
      if (char === " " || char === "\t" || char === "\r" || char === "\n") {
        this.advance();
      } else if (char === "/" && this.peek(1) === "/") {
        while (this.pos < this.source.length && this.peek() !== "\n") this.advance();
      } else if (char === "/" && this.peek(1) === "*") {
        this.advance();
        this.advance();
        while (this.pos < this.source.length && !(this.peek() === "*" && this.peek(1) === "/")) this.advance();
        this.advance();
        this.advance();
      } else {
        break;
      }
    }
  }

  /** Emit a token whose text is already known, first consuming `consume` characters
   * so the end position reflects the whole glyph. Used by the fixed-width readers
   * (single chars, `&&`/`||`); the string/raw readers pass `consume: 0` because
   * they have already advanced the cursor themselves. */
  private push(kind: TokenKind, value: string, line: number, column: number, consume: number): void {
    for (let i = 0; i < consume; i++) this.advance();
    this.tokens.push({ kind, value, line, column, endLine: this.line, endColumn: this.column });
  }

  /** Look at the character `offset` ahead of the cursor without consuming it.
   * Returns `""` past the end of input, so callers can compare safely at EOF. */
  private peek(offset = 0): string {
    return this.source[this.pos + offset] ?? "";
  }

  /** Move the cursor forward one character, keeping the 1-based line/column in sync
   * (a `\n` bumps the line and resets the column). This is the ONLY place `pos`,
   * `line`, and `column` change together, which keeps spans accurate. */
  private advance(): void {
    if (this.source[this.pos] === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    this.pos += 1;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FREE HELPERS — pure functions with no cursor state
// ═══════════════════════════════════════════════════════════════════════════════

/** Decode a backslash-escaped character in a double-quoted string. */
function unescape(char: string): string {
  switch (char) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    default:
      return char; // `\"`, `\\`, and anything else pass through literally
  }
}

/** True if `char` may begin an identifier: an ASCII letter or underscore. */
function isIdentifierStart(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_";
}

/** True if `char` may continue an identifier: an identifier-start char or a digit. */
function isIdentifierPart(char: string): boolean {
  return isIdentifierStart(char) || (char >= "0" && char <= "9");
}

/** True if `char` is an ASCII decimal digit. */
function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

/** Normalise a raw (`"""`) string body: drop fully-blank leading/trailing lines,
 * then remove the largest indentation common to all non-blank lines. This lets an
 * author indent a multi-line block to match the surrounding code without that
 * indentation leaking into the literal value. */
function stripCommonIndent(text: string): string {
  const lines = text.split("\n");
  while (lines.length > 0 && (lines[0] ?? "").trim() === "") lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();

  let min = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    min = Math.min(min, line.length - line.trimStart().length);
  }
  if (!Number.isFinite(min)) min = 0;

  return lines.map((line) => line.slice(min)).join("\n");
}
