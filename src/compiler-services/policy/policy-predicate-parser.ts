import { TokenKind, type Token } from "../parse/lexer.js";
import {
    PolicyNodeKind,
    PolicyRefRoot,
    PolicyBoolOp,
    PolicyCompareOp,
    type PolicyPredicate,
    type PolicyOperand,
    type PolicyRef,
} from "./policy-predicate.js";

export class PolicyParseError extends Error
{
    public constructor(message: string)
    {
        super(message);
        this.name = "PolicyParseError";
    }
}

/**
 * Parse a policy predicate from its token slice. A trailing lexer EOF token is
 * ignored; any other leftover token is an error.
 */
export function parsePolicyPredicate(tokens: Token[]): PolicyPredicate
{
    const parser = new PolicyPredicateParser(tokens.filter(t => t.kind !== TokenKind.EOF));
    const predicate = parser.ParseOr();
    parser.ExpectEnd();
    return predicate;
}

class PolicyPredicateParser
{
    private static readonly KwOr = "or";
    private static readonly KwAnd = "and";
    private static readonly KwNot = "not";
    private static readonly KwHas = "has";
    private static readonly KwIn = "in";
    private static readonly KwPrincipal = "principal";
    private static readonly KwEntity = "entity";
    private static readonly KwTrue = "true";
    private static readonly KwFalse = "false";
    private static readonly OpEq = "==";
    private static readonly OpNeq = "!=";

    private pos = 0;

    public constructor(private readonly tokens: Token[])
    {
    }

    public ParseOr(): PolicyPredicate
    {
        let left = this.ParseAnd();
        while (this.MatchKeyword(PolicyPredicateParser.KwOr))
        {
            left = { kind: PolicyNodeKind.Bool, op: PolicyBoolOp.Or, left, right: this.ParseAnd() };
        }
        return left;
    }

    public ExpectEnd(): void
    {
        if (this.pos < this.tokens.length)
        {
            throw this.Error("unexpected trailing tokens in policy predicate");
        }
    }

    private ParseAnd(): PolicyPredicate
    {
        let left = this.ParseNot();
        while (this.MatchKeyword(PolicyPredicateParser.KwAnd))
        {
            left = { kind: PolicyNodeKind.Bool, op: PolicyBoolOp.And, left, right: this.ParseNot() };
        }
        return left;
    }

    private ParseNot(): PolicyPredicate
    {
        if (this.MatchKeyword(PolicyPredicateParser.KwNot))
        {
            return { kind: PolicyNodeKind.Not, operand: this.ParseNot() };
        }
        return this.ParsePrimary();
    }

    private ParsePrimary(): PolicyPredicate
    {
        if (this.Match(TokenKind.LParen))
        {
            const inner = this.ParseOr();
            this.Expect(TokenKind.RParen);
            return inner;
        }
        return this.ParseComparisonOrMembership();
    }

    private ParseComparisonOrMembership(): PolicyPredicate
    {
        const left = this.ParseOperand();
        if (this.MatchSymbol(PolicyPredicateParser.OpEq))
        {
            return { kind: PolicyNodeKind.Compare, op: PolicyCompareOp.Eq, left, right: this.ParseOperand() };
        }
        if (this.MatchSymbol(PolicyPredicateParser.OpNeq))
        {
            return { kind: PolicyNodeKind.Compare, op: PolicyCompareOp.Neq, left, right: this.ParseOperand() };
        }
        if (this.MatchKeyword(PolicyPredicateParser.KwHas))
        {
            if (left.kind !== PolicyNodeKind.Ref)
            {
                throw this.Error("left side of has must be a principal/entity reference");
            }
            return { kind: PolicyNodeKind.Membership, collection: left, item: this.ParseOperand() };
        }
        if (this.MatchKeyword(PolicyPredicateParser.KwIn))
        {
            const collection = this.ParseOperand();
            if (collection.kind !== PolicyNodeKind.Ref)
            {
                throw this.Error("right side of in must be a principal/entity reference");
            }
            return { kind: PolicyNodeKind.Membership, collection, item: left };
        }
        throw this.Error("expected ==, !=, has or in after operand");
    }

    private ParseOperand(): PolicyOperand
    {
        const token = this.Current();
        if (token === undefined)
        {
            throw this.Error("unexpected end of policy predicate");
        }
        if (token.kind === TokenKind.String)
        {
            this.pos += 1;
            return { kind: PolicyNodeKind.Literal, value: token.value };
        }
        if (token.kind === TokenKind.Number)
        {
            this.pos += 1;
            return { kind: PolicyNodeKind.Literal, value: Number(token.value) };
        }
        if (token.kind === TokenKind.Identifier)
        {
            if (token.value === PolicyPredicateParser.KwTrue || token.value === PolicyPredicateParser.KwFalse)
            {
                this.pos += 1;
                return { kind: PolicyNodeKind.Literal, value: token.value === PolicyPredicateParser.KwTrue };
            }
            if (token.value === PolicyPredicateParser.KwPrincipal)
            {
                return this.ParseRef(PolicyRefRoot.Principal);
            }
            if (token.value === PolicyPredicateParser.KwEntity)
            {
                return this.ParseRef(PolicyRefRoot.Entity);
            }
        }
        throw this.Error("expected a principal/entity reference or literal");
    }

    private ParseRef(root: PolicyRefRoot): PolicyRef
    {
        this.pos += 1;
        this.Expect(TokenKind.Dot);
        const member = this.Expect(TokenKind.Identifier).value;
        return { kind: PolicyNodeKind.Ref, root, member };
    }

    private Current(): Token | undefined
    {
        return this.tokens[this.pos];
    }

    private Match(kind: TokenKind): boolean
    {
        if (this.Current()?.kind === kind)
        {
            this.pos += 1;
            return true;
        }
        return false;
    }

    private MatchSymbol(value: string): boolean
    {
        const token = this.Current();
        if (token?.kind === TokenKind.SymbolOp && token.value === value)
        {
            this.pos += 1;
            return true;
        }
        return false;
    }

    private MatchKeyword(word: string): boolean
    {
        const token = this.Current();
        if (token?.kind === TokenKind.Identifier && token.value === word)
        {
            this.pos += 1;
            return true;
        }
        return false;
    }

    private Expect(kind: TokenKind): Token
    {
        const token = this.Current();
        if (token === undefined || token.kind !== kind)
        {
            throw this.Error(`expected "${kind}"`);
        }
        this.pos += 1;
        return token;
    }

    private Error(message: string): PolicyParseError
    {
        const token = this.Current();
        if (token === undefined)
        {
            return new PolicyParseError(`${message} at end of predicate`);
        }
        return new PolicyParseError(`${message} at ${token.line}:${token.column} (got "${token.value}")`);
    }
}
