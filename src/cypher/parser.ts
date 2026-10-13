import type { Scalar } from "../manifest/logical.js";
import { CypherLexer, Token } from "./lexer.js";
import { TokenKind, RelDirection, ComparisonOp, BooleanOp } from "./enums.js";
import { CypherSyntaxError } from "./errors.js";
import { NodePattern, RelPattern, PatternPath } from "./patterns.js";
import {
    CypherQueryModel, MatchClause, WhereClause, ReadingClause,
    ProjectionClause, QueryPart, SortItem, ReturnItem,
} from "./query-model.js";
import {
    Expression, VariableRef, PropertyAccess, Literal, Parameter,
    Comparison, BooleanExpression, IsNullExpression, InExpression, FunctionCall,
} from "./expressions.js";

export class CypherParser
{
    private static readonly KwMatch = "MATCH";
    private static readonly KwWhere = "WHERE";
    private static readonly KwReturn = "RETURN";
    private static readonly KwWith = "WITH";
    private static readonly KwAs = "AS";
    private static readonly KwAnd = "AND";
    private static readonly KwOr = "OR";
    private static readonly KwNot = "NOT";
    private static readonly KwIs = "IS";
    private static readonly KwNull = "NULL";
    private static readonly KwIn = "IN";
    private static readonly KwTrue = "TRUE";
    private static readonly KwFalse = "FALSE";
    private static readonly KwOrder = "ORDER";
    private static readonly KwBy = "BY";
    private static readonly KwAsc = "ASC";
    private static readonly KwDesc = "DESC";
    private static readonly KwSkip = "SKIP";
    private static readonly KwLimit = "LIMIT";
    private static readonly KwDistinct = "DISTINCT";
    private static readonly Expected = "expected";
    private static readonly ExpectedProjection = "expected RETURN or WITH";

    private readonly tokens: Token[];
    private index = 0;

    constructor(source: string)
    {
        this.tokens = new CypherLexer(source).Tokenize();
    }

    public Parse(): CypherQueryModel
    {
        const parts: QueryPart[] = [];
        for (;;)
        {
            const reading = this.parseReadingClauses();
            const projection = this.parseProjection();
            parts.push(new QueryPart(reading, projection));
            if (projection.IsReturn)
            {
                break;
            }
            // A WITH must be followed by at least one more query part ending in RETURN.
        }
        this.expect(TokenKind.Eof);
        return new CypherQueryModel(parts);
    }

    private parseReadingClauses(): ReadingClause[]
    {
        const out: ReadingClause[] = [];
        while (this.peekKeyword(CypherParser.KwMatch))
        {
            out.push(this.parseMatch());
        }
        return out;
    }

    private parseMatch(): MatchClause
    {
        this.expectKeyword(CypherParser.KwMatch);
        const paths = [this.parsePath()];
        while (this.accept(TokenKind.Comma)) paths.push(this.parsePath());
        const where = this.peekKeyword(CypherParser.KwWhere) ? this.parseWhere() : undefined;
        return new MatchClause(paths, where, false);
    }

    private parsePath(): PatternPath
    {
        const nodes = [this.parseNode()];
        const rels: RelPattern[] = [];
        while (this.peek().Kind === TokenKind.Dash || this.peek().Kind === TokenKind.ArrowLeft)
        {
            rels.push(this.parseRel());
            nodes.push(this.parseNode());
        }
        return new PatternPath(nodes, rels);
    }

    private parseNode(): NodePattern
    {
        this.expect(TokenKind.LParen);
        const variable = this.peek().Kind === TokenKind.Identifier ? this.advance().Text : undefined;
        const label = this.accept(TokenKind.Colon) ? this.expect(TokenKind.Identifier).Text : undefined;
        const props = this.peek().Kind === TokenKind.LBrace ? this.parsePropMap() : new Map<string, Scalar>();
        this.expect(TokenKind.RParen);
        return new NodePattern(variable, label, props);
    }

    private parseRel(): RelPattern
    {
        let incoming = false;
        if (this.accept(TokenKind.ArrowLeft)) incoming = true;
        else this.expect(TokenKind.Dash);

        let variable: string | undefined;
        let relType: string | undefined;
        let props = new Map<string, Scalar>();
        if (this.accept(TokenKind.LBracket))
        {
            variable = this.peek().Kind === TokenKind.Identifier ? this.advance().Text : undefined;
            relType = this.accept(TokenKind.Colon) ? this.expect(TokenKind.Identifier).Text : undefined;
            if (this.peek().Kind === TokenKind.LBrace) props = this.parsePropMap();
            this.expect(TokenKind.RBracket);
        }

        let outgoing = false;
        if (this.accept(TokenKind.ArrowRight)) outgoing = true;
        else this.expect(TokenKind.Dash);

        const direction = incoming ? RelDirection.Incoming : (outgoing ? RelDirection.Outgoing : RelDirection.Undirected);
        return new RelPattern(variable, relType, direction, props);
    }

    private parsePropMap(): Map<string, Scalar>
    {
        this.expect(TokenKind.LBrace);
        const map = new Map<string, Scalar>();
        if (this.peek().Kind !== TokenKind.RBrace)
        {
            do
            {
                const key = this.expect(TokenKind.Identifier).Text;
                this.expect(TokenKind.Colon);
                map.set(key, this.parseScalarLiteral());
            }
            while (this.accept(TokenKind.Comma));
        }
        this.expect(TokenKind.RBrace);
        return map;
    }

    private parseWhere(): WhereClause
    {
        this.expectKeyword(CypherParser.KwWhere);
        return new WhereClause(this.parseExpression());
    }

    private parseProjection(): ProjectionClause
    {
        let isReturn: boolean;
        if (this.acceptKeyword(CypherParser.KwReturn)) isReturn = true;
        else if (this.acceptKeyword(CypherParser.KwWith)) isReturn = false;
        else throw this.error(CypherParser.ExpectedProjection);

        const distinct = this.acceptKeyword(CypherParser.KwDistinct);
        const items = [this.parseReturnItem()];
        while (this.accept(TokenKind.Comma)) items.push(this.parseReturnItem());

        const orderBy = this.peekKeyword(CypherParser.KwOrder) ? this.parseOrderBy() : undefined;
        const skip = this.acceptKeyword(CypherParser.KwSkip) ? this.parseExpression() : undefined;
        const limit = this.acceptKeyword(CypherParser.KwLimit) ? this.parseExpression() : undefined;
        return new ProjectionClause(items, distinct, orderBy, skip, limit, isReturn);
    }

    private parseOrderBy(): SortItem[]
    {
        this.expectKeyword(CypherParser.KwOrder);
        this.expectKeyword(CypherParser.KwBy);
        const items = [this.parseSortItem()];
        while (this.accept(TokenKind.Comma)) items.push(this.parseSortItem());
        return items;
    }

    private parseSortItem(): SortItem
    {
        const expr = this.parseExpression();
        let descending = false;
        if (this.acceptKeyword(CypherParser.KwDesc)) descending = true;
        else this.acceptKeyword(CypherParser.KwAsc);
        return new SortItem(expr, descending);
    }

    private parseReturnItem(): ReturnItem
    {
        const expr = this.parseExpression();
        const alias = this.acceptKeyword(CypherParser.KwAs) ? this.expect(TokenKind.Identifier).Text : undefined;
        return new ReturnItem(expr, alias);
    }

    private parseExpression(): Expression
    {
        return this.parseOr();
    }

    private parseOr(): Expression
    {
        let left = this.parseAnd();
        while (this.acceptKeyword(CypherParser.KwOr)) left = new BooleanExpression(BooleanOp.Or, [left, this.parseAnd()]);
        return left;
    }

    private parseAnd(): Expression
    {
        let left = this.parseNot();
        while (this.acceptKeyword(CypherParser.KwAnd)) left = new BooleanExpression(BooleanOp.And, [left, this.parseNot()]);
        return left;
    }

    private parseNot(): Expression
    {
        if (this.acceptKeyword(CypherParser.KwNot)) return new BooleanExpression(BooleanOp.Not, [this.parseNot()]);
        return this.parsePredicate();
    }

    private parsePredicate(): Expression
    {
        const left = this.parsePrimary();
        const cmp = this.tryComparisonOp();
        if (cmp !== undefined) return new Comparison(left, cmp, this.parsePrimary());
        if (this.acceptKeyword(CypherParser.KwIs))
        {
            const negated = this.acceptKeyword(CypherParser.KwNot);
            this.expectKeyword(CypherParser.KwNull);
            return new IsNullExpression(left, negated);
        }
        if (this.acceptKeyword(CypherParser.KwIn)) return new InExpression(left, this.parseLiteralList());
        return left;
    }

    private parseLiteralList(): Expression[]
    {
        this.expect(TokenKind.LBracket);
        const list: Expression[] = [];
        if (this.peek().Kind !== TokenKind.RBracket)
        {
            do
            {
                list.push(new Literal(this.parseScalarLiteral()));
            }
            while (this.accept(TokenKind.Comma));
        }
        this.expect(TokenKind.RBracket);
        return list;
    }

    private parsePrimary(): Expression
    {
        if (this.accept(TokenKind.Dollar)) return new Parameter(this.expect(TokenKind.Identifier).Text);
        if (this.peek().Kind === TokenKind.Identifier)
        {
            const name = this.advance().Text;
            if (this.accept(TokenKind.Dot)) return new PropertyAccess(name, this.expect(TokenKind.Identifier).Text);
            if (this.accept(TokenKind.LParen)) return this.parseCallArguments(name);
            return new VariableRef(name);
        }
        return new Literal(this.parseScalarLiteral());
    }

    private parseCallArguments(name: string): FunctionCall
    {
        if (this.accept(TokenKind.Star))
        {
            this.expect(TokenKind.RParen);
            return new FunctionCall(name, [], false, true);
        }
        const distinct = this.acceptKeyword(CypherParser.KwDistinct);
        const args: Expression[] = [];
        if (this.peek().Kind !== TokenKind.RParen)
        {
            do
            {
                args.push(this.parseExpression());
            }
            while (this.accept(TokenKind.Comma));
        }
        this.expect(TokenKind.RParen);
        return new FunctionCall(name, args, distinct, false);
    }

    private parseScalarLiteral(): Scalar
    {
        const t = this.peek();
        if (t.Kind === TokenKind.String)
        {
            this.advance();
            return t.Text;
        }
        if (t.Kind === TokenKind.Number)
        {
            this.advance();
            return Number(t.Text);
        }
        if (t.Kind === TokenKind.Keyword && (t.Text === CypherParser.KwTrue || t.Text === CypherParser.KwFalse))
        {
            this.advance();
            return t.Text === CypherParser.KwTrue;
        }
        throw this.error(`${CypherParser.Expected} a literal`);
    }

    private tryComparisonOp(): ComparisonOp | undefined
    {
        const map: ReadonlyMap<TokenKind, ComparisonOp> = new Map([
            [TokenKind.Eq, ComparisonOp.Eq], [TokenKind.Neq, ComparisonOp.Neq],
            [TokenKind.Lt, ComparisonOp.Lt], [TokenKind.Lte, ComparisonOp.Lte],
            [TokenKind.Gt, ComparisonOp.Gt], [TokenKind.Gte, ComparisonOp.Gte],
        ]);
        const op = map.get(this.peek().Kind);
        if (op !== undefined) this.advance();
        return op;
    }

    private peek(): Token
    {
        // The token stream is always Eof-terminated, so the index is in range.
        return this.tokens[this.index]!;
    }

    private advance(): Token
    {
        // The token stream is always Eof-terminated, so the index is in range.
        return this.tokens[this.index++]!;
    }

    private accept(kind: TokenKind): boolean
    {
        if (this.peek().Kind !== kind) return false;
        this.index++;
        return true;
    }

    private expect(kind: TokenKind): Token
    {
        if (this.peek().Kind !== kind) throw this.error(`${CypherParser.Expected} ${TokenKind[kind]}`);
        return this.advance();
    }

    private peekKeyword(word: string): boolean
    {
        const t = this.peek();
        return t.Kind === TokenKind.Keyword && t.Text === word;
    }

    private acceptKeyword(word: string): boolean
    {
        if (!this.peekKeyword(word)) return false;
        this.index++;
        return true;
    }

    private expectKeyword(word: string): Token
    {
        if (!this.peekKeyword(word)) throw this.error(`${CypherParser.Expected} ${word}`);
        return this.advance();
    }

    private error(message: string): CypherSyntaxError
    {
        const t = this.peek();
        return new CypherSyntaxError(message, t.Line, t.Column);
    }
}
