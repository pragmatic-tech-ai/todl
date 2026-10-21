import { TokenKind } from "./enums.js";
import { CypherSyntaxError } from "./errors.js";

export class Token
{
    constructor(
        public readonly Kind: TokenKind,
        public readonly Text: string,
        public readonly Line: number,
        public readonly Column: number,
        // Original source spelling; differs from Text only for keywords (Text is upper-cased).
        public readonly Raw: string = Text,
    )
    {
    }
}

export class CypherLexer
{
    private static readonly Keywords = new Set<string>(
        [
            "MATCH", "OPTIONAL", "UNWIND", "WHERE", "RETURN", "AS", "AND", "OR", "NOT", "IS", "NULL", "IN", "TRUE", "FALSE",
            "WITH", "ORDER", "BY", "ASC", "DESC", "SKIP", "LIMIT", "DISTINCT",
            "CREATE", "MERGE", "SET", "DELETE", "DETACH", "REMOVE",
        ],
    );
    private static readonly TwoCharKinds: ReadonlyMap<string, TokenKind> = new Map([
        ["->", TokenKind.ArrowRight], ["<-", TokenKind.ArrowLeft],
        ["+=", TokenKind.PlusEq], ["<=", TokenKind.Lte], [">=", TokenKind.Gte], ["<>", TokenKind.Neq],
    ]);
    private static readonly OneCharKinds: ReadonlyMap<string, TokenKind> = new Map([
        ["(", TokenKind.LParen], [")", TokenKind.RParen],
        ["[", TokenKind.LBracket], ["]", TokenKind.RBracket],
        ["{", TokenKind.LBrace], ["}", TokenKind.RBrace],
        [":", TokenKind.Colon], [",", TokenKind.Comma], [".", TokenKind.Dot],
        ["$", TokenKind.Dollar], ["-", TokenKind.Dash], ["*", TokenKind.Star],
        ["+", TokenKind.Plus], ["/", TokenKind.Slash], ["%", TokenKind.Percent],
        ["=", TokenKind.Eq], ["<", TokenKind.Lt], [">", TokenKind.Gt],
    ]);
    private static readonly Quote = "'";
    private static readonly Newline = "\n";
    private static readonly DecimalPoint = ".";
    private static readonly ZeroDigit = "0";
    private static readonly NineDigit = "9";
    private static readonly WhitespacePattern = /\s/;
    private static readonly IdentStartPattern = /[A-Za-z_]/;
    private static readonly IdentPartPattern = /[A-Za-z0-9_]/;
    private static readonly UnterminatedString = "unterminated string literal";
    private static readonly UnexpectedChar = "unexpected character";

    private pos = 0;
    private line = 1;
    private column = 1;

    constructor(private readonly source: string)
    {
    }

    public Tokenize(): Token[]
    {
        const out: Token[] = [];
        for (;;)
        {
            this.skipWhitespace();
            if (this.pos >= this.source.length)
            {
                out.push(new Token(TokenKind.Eof, "", this.line, this.column));
                return out;
            }
            out.push(this.next());
        }
    }

    // charAt returns "" (never undefined) past the end, so it stays a plain string under noUncheckedIndexedAccess.
    private current(): string
    {
        return this.source.charAt(this.pos);
    }

    private next(): Token
    {
        const ch = this.current();
        const line = this.line;
        const column = this.column;
        if (ch === CypherLexer.Quote) return this.readString(line, column);
        if (this.isDigit(ch)) return this.readNumber(line, column);
        if (this.isIdentStart(ch)) return this.readWord(line, column);
        return this.readSymbol(line, column);
    }

    private readSymbol(line: number, column: number): Token
    {
        const two = this.source.substr(this.pos, 2);
        const matchedTwo = CypherLexer.TwoCharKinds.get(two);
        if (matchedTwo !== undefined)
        {
            this.advance(2);
            return new Token(matchedTwo, two, line, column);
        }
        const one = this.current();
        const matchedOne = CypherLexer.OneCharKinds.get(one);
        if (matchedOne === undefined) throw new CypherSyntaxError(`${CypherLexer.UnexpectedChar} '${one}'`, line, column);
        this.advance(1);
        return new Token(matchedOne, one, line, column);
    }

    private readString(line: number, column: number): Token
    {
        this.advance(1); // opening quote
        let value = "";
        for (;;)
        {
            while (this.pos < this.source.length && this.current() !== CypherLexer.Quote)
            {
                value += this.current();
                this.advance(1);
            }
            if (this.pos >= this.source.length) throw new CypherSyntaxError(CypherLexer.UnterminatedString, line, column);
            // A doubled quote is an escaped quote inside the literal (SQL style); backslash and newline stay literal.
            if (this.source.charAt(this.pos + 1) !== CypherLexer.Quote) break;
            value += CypherLexer.Quote;
            this.advance(2);
        }
        this.advance(1); // closing quote
        return new Token(TokenKind.String, value, line, column);
    }

    private readNumber(line: number, column: number): Token
    {
        let value = "";
        // A '.' belongs to the number only when a digit follows, so "1..2" lexes as 1 . . 2.
        while (this.pos < this.source.length && (this.isDigit(this.current())
            || (this.current() === CypherLexer.DecimalPoint && this.isDigit(this.source.charAt(this.pos + 1)))))
        {
            value += this.current();
            this.advance(1);
        }
        return new Token(TokenKind.Number, value, line, column);
    }

    private readWord(line: number, column: number): Token
    {
        let value = "";
        while (this.pos < this.source.length && this.isIdentPart(this.current()))
        {
            value += this.current();
            this.advance(1);
        }
        const upper = value.toUpperCase();
        if (CypherLexer.Keywords.has(upper)) return new Token(TokenKind.Keyword, upper, line, column, value);
        return new Token(TokenKind.Identifier, value, line, column);
    }

    private skipWhitespace(): void
    {
        while (this.pos < this.source.length && CypherLexer.WhitespacePattern.test(this.current())) this.advance(1);
    }

    private advance(n: number): void
    {
        for (let i = 0; i < n; i++)
        {
            if (this.current() === CypherLexer.Newline)
            {
                this.line++;
                this.column = 1;
            }
            else
            {
                this.column++;
            }
            this.pos++;
        }
    }

    private isDigit(ch: string): boolean
    {
        return ch >= CypherLexer.ZeroDigit && ch <= CypherLexer.NineDigit;
    }

    private isIdentStart(ch: string): boolean
    {
        return CypherLexer.IdentStartPattern.test(ch);
    }

    private isIdentPart(ch: string): boolean
    {
        return CypherLexer.IdentPartPattern.test(ch);
    }
}
