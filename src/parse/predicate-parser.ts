/**
 * Predicate parser — a small, self-contained recursive-descent parser for the
 * TODL invariant PREDICATE sub-language. It takes a predicate token slice
 * (captured by the declaration parser from a `predicate = …` invariant) and
 * produces a predicate {@link Expr} AST (design spec §4.5) from
 * `../predicate/ast.ts`. The loader calls the exported {@link parsePredicate}
 * for every concept invariant it stages; the resulting `Expr` is what the
 * validator later evaluates against instances.
 *
 * ─────────────────────────── What a predicate is ───────────────────────────
 * A predicate is a boolean expression written on the members of `this` (the
 * instance being validated) — e.g. `this.owner != none && this.tags in
 * this.allowed`. This is a *separate, tiny* language from the main declaration
 * grammar: it has no statements, no declarations, just an expression tree of
 * logical / comparison / member operators over identifiers, `this`, and `none`.
 *
 * ──────────────────────── How the parser is structured ─────────────────────
 * This is a classic recursive-descent parser with one method per PRECEDENCE
 * LEVEL. Each tier parses the level above it first, then folds in its own
 * operator, so the lowest-precedence operator ends up highest in the tree and
 * binds most loosely. The delegation chain, lowest → highest precedence:
 *
 *     parseOr        `||`         (loosest)
 *       └ parseAnd   `&&`
 *          └ parseImplies         `implies`
 *             └ parseComparison   `==` / `!=` / `in`
 *                └ parsePostfix   `.member` chains
 *                   └ parsePrimary   `this` / `none` / `(…)` / `&name` / ident (tightest)
 *
 * The parser walks a flat `Token[]` via a movable cursor (`pos`) with a family
 * of small helpers — `current` / `check` / `match` / `advance` / `expect` —
 * that peek, conditionally consume, or force-consume the next token.
 *
 * ─────────────────────────────── Desugarings ───────────────────────────────
 * `x.empty` desugars to `x == none` (both mean "the set is empty").
 */

import { TokenKind, type Token } from "./lexer.js";
import {
  THIS,
  NONE,
  name,
  member,
  eq,
  neq,
  isIn,
  and,
  or,
  implies,
  type Expr,
} from "../predicate/ast.js";

/**
 * Parse a full predicate from its token slice into an {@link Expr} tree.
 *
 * Entry point invoked by the loader for each concept invariant. Parses one
 * complete expression and asserts nothing is left over (`expectEnd`), so a
 * malformed predicate throws rather than silently ignoring trailing tokens.
 */
export function parsePredicate(tokens: Token[]): Expr {
  const parser = new PredicateParser(tokens);
  const expr = parser.parseExpression();
  parser.expectEnd();
  return expr;
}

/**
 * Cursor-driven recursive-descent parser over a predicate token slice. One
 * instance is spun up per predicate; `pos` is the read cursor into `tokens`.
 */
class PredicateParser {
  /** Index of the next unconsumed token in `tokens`. */
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  /** Parse a whole expression — the top of the precedence chain (`||`). */
  parseExpression(): Expr {
    return this.parseOr();
  }

  // ───────────────────────────────────────────────────────────────────────
  // Precedence levels (loosest → tightest). Each method parses the next-tighter
  // level first, then left-folds its own operator over the results, so lower
  // precedence sits higher in the resulting tree.
  // ───────────────────────────────────────────────────────────────────────

  /** `a || b || c` — logical OR, the loosest operator. Left-associative. */
  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.match(TokenKind.Or)) {
      left = or(left, this.parseAnd());
    }
    return left;
  }

  /** `a && b && c` — logical AND, binds tighter than `||`. Left-associative. */
  private parseAnd(): Expr {
    let left = this.parseImplies();
    while (this.match(TokenKind.And)) {
      left = and(left, this.parseImplies());
    }
    return left;
  }

  /** `a implies b` — material implication. Non-chaining (at most one). */
  private parseImplies(): Expr {
    const left = this.parseComparison();
    if (this.matchKeyword("implies")) {
      return implies(left, this.parseComparison());
    }
    return left;
  }

  /**
   * `a == b`, `a != b`, `a in b` — comparison / membership. Non-chaining: at
   * most one comparison operator per level (no `a == b == c`).
   */
  private parseComparison(): Expr {
    const left = this.parsePostfix();
    if (this.matchSymbol("==")) return eq(left, this.parsePostfix());
    if (this.matchSymbol("!=")) return neq(left, this.parsePostfix());
    if (this.matchKeyword("in")) return isIn(left, this.parsePostfix());
    return left;
  }

  /**
   * `a.b.c` — member-access postfix chain, applied left-to-right. The special
   * trailing `.empty` desugars to `== none` (an empty set equals `none`)
   * instead of producing a member access.
   */
  private parsePostfix(): Expr {
    let left = this.parsePrimary();
    while (this.match(TokenKind.Dot)) {
      const member_ = this.expectIdentifier();
      left = member_ === "empty" ? eq(left, NONE) : member(left, member_);
    }
    return left;
  }

  /**
   * The atoms — tightest binding. In order: the `this` / `none` keywords, a
   * parenthesised sub-expression (which re-enters the top of the chain), an
   * `&name` reference, or a bare identifier. Anything else is a syntax error.
   */
  private parsePrimary(): Expr {
    if (this.matchKeyword("this")) return THIS;
    if (this.matchKeyword("none")) return NONE;
    if (this.match(TokenKind.LParen)) {
      // Parentheses reset precedence: parse a whole expression, then require `)`.
      const inner = this.parseExpression();
      this.expect(TokenKind.RParen);
      return inner;
    }
    if (this.match(TokenKind.Amp)) {
      // `&name` — an explicit name reference; the `&` is consumed, the ident kept.
      return name(this.expectIdentifier());
    }
    if (this.check(TokenKind.Identifier)) {
      return name(this.advance().value);
    }
    throw this.error("expected an expression");
  }

  /** Assert the whole token slice was consumed — else the predicate is malformed. */
  expectEnd(): void {
    if (this.pos < this.tokens.length) {
      throw this.error("unexpected trailing tokens in predicate");
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Cursor helpers — peek / check / (conditionally) consume tokens at `pos`.
  //   current / check / checkKeyword  → look without consuming
  //   match / matchSymbol / matchKeyword → consume only if it matches (bool)
  //   advance / expect / expectIdentifier → consume, throwing on mismatch
  // ───────────────────────────────────────────────────────────────────────

  /** The token under the cursor, or `undefined` past the end. */
  private current(): Token | undefined {
    return this.tokens[this.pos];
  }

  /** Is the current token of `kind`? (Peek only, no consume.) */
  private check(kind: TokenKind): boolean {
    return this.current()?.kind === kind;
  }

  /** Is the current token the identifier `word`? Keywords are lexed as idents. */
  private checkKeyword(word: string): boolean {
    const token = this.current();
    return token?.kind === TokenKind.Identifier && token.value === word;
  }

  /** Consume the current token if it is `kind`; report whether it did. */
  private match(kind: TokenKind): boolean {
    if (this.check(kind)) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  /** Match a SymbolOp token with exactly `value` (e.g. `==`, `!=`). */
  private matchSymbol(value: string): boolean {
    const token = this.current();
    if (token?.kind === TokenKind.SymbolOp && token.value === value) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  /** Consume the current token if it is the keyword `word`; report success. */
  private matchKeyword(word: string): boolean {
    if (this.checkKeyword(word)) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  /** Consume and return the current token; throw if already at the end. */
  private advance(): Token {
    const token = this.current();
    if (token === undefined) throw this.error("unexpected end of predicate");
    this.pos += 1;
    return token;
  }

  /** Consume the current token, requiring it to be `kind`; throw otherwise. */
  private expect(kind: TokenKind): Token {
    if (!this.check(kind)) throw this.error(`expected "${kind}"`);
    return this.advance();
  }

  /** Consume an identifier token and return its text. */
  private expectIdentifier(): string {
    return this.expect(TokenKind.Identifier).value;
  }

  /** Build a syntax Error pinned to the current token's line:column (or EOF). */
  private error(message: string): Error {
    const token = this.current();
    if (token === undefined) return new Error(`${message} at end of predicate`);
    const got = token.value.length > 0 ? token.value : token.kind;
    return new Error(`${message} at ${token.line}:${token.column} (got "${got}")`);
  }
}
