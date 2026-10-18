import type { Scalar } from "../manifest/logical.js";
import { ArithmeticOp, BooleanOp, ComparisonOp, RelDirection } from "./enums.js";
import { CypherSemanticError } from "./errors.js";
import {
    ArithmeticExpression, BooleanExpression, Comparison, Expression, FunctionCall, InExpression, IndexAccess, IsNullExpression,
    ListLiteral, Literal, MapLiteral, Parameter, PropertyAccess, UnaryMinus, ValueLiteral, VariableRef,
} from "./expressions.js";
import { NodePattern, PatternPath, RelPattern } from "./patterns.js";
import { CypherQueryModel, MatchClause, ProjectionClause, QueryPart, ReadingClause, ReturnItem, SortItem, UnwindClause, WhereClause } from "./query-model.js";

// Binding strength of an expression's top-level form, mirroring the parser's precedence ladder (higher binds tighter).
enum Prec
{
    Or = 1,
    And = 2,
    Not = 3,
    Predicate = 4,
    Additive = 5,
    Multiplicative = 6,
    Unary = 7,
    Postfix = 8,
}

// Renders a CypherQueryModel back to Cypher text that CypherParser re-accepts (the fluent builder's wire form).
export class CypherUnparser
{
    private static readonly Empty = "";
    private static readonly Space = " ";
    private static readonly Comma = ", ";
    private static readonly OpenParen = "(";
    private static readonly CloseParen = ")";
    private static readonly OpenBracket = "[";
    private static readonly CloseBracket = "]";
    private static readonly OpenBrace = "{";
    private static readonly CloseBrace = "}";
    private static readonly Colon = ":";
    private static readonly Dot = ".";
    private static readonly Dash = "-";
    private static readonly Star = "*";
    private static readonly Equals = "=";
    private static readonly RangeDots = "..";
    private static readonly Dollar = "$";
    private static readonly ArrowRight = ">";
    private static readonly ArrowLeft = "<";
    private static readonly KeyValueSeparator = ": ";
    private static readonly Quote = "'";
    private static readonly EscapedQuote = "''";
    private static readonly KwMatch = "MATCH";
    private static readonly KwOptional = "OPTIONAL";
    private static readonly KwUnwind = "UNWIND";
    private static readonly KwAs = "AS";
    private static readonly KwWhere = "WHERE";
    private static readonly KwReturn = "RETURN";
    private static readonly KwWith = "WITH";
    private static readonly KwDistinct = "DISTINCT";
    private static readonly KwOrderBy = "ORDER BY";
    private static readonly KwDesc = "DESC";
    private static readonly KwSkip = "SKIP";
    private static readonly KwLimit = "LIMIT";
    private static readonly KwAnd = "AND";
    private static readonly KwOr = "OR";
    private static readonly KwNot = "NOT";
    private static readonly KwIsNull = "IS NULL";
    private static readonly KwIsNotNull = "IS NOT NULL";
    private static readonly KwIn = "IN";
    private static readonly KwNull = "NULL";
    private static readonly KwTrue = "TRUE";
    private static readonly KwFalse = "FALSE";
    private static readonly Zero = "0";
    private static readonly ExponentPattern = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/;
    private static readonly UnsupportedValueLiteral = "cannot render a bound value literal as Cypher text";
    private static readonly UnsupportedNumber = "cannot render number as Cypher text: ";
    private static readonly UnsupportedInItem = "IN list items must be scalar literals to render as Cypher text";
    private static readonly UnsupportedNullScalar = "null is not a scalar literal in a pattern property map";

    private static readonly ComparisonSymbols: ReadonlyMap<ComparisonOp, string> = new Map([
        [ComparisonOp.Eq, "="], [ComparisonOp.Neq, "<>"], [ComparisonOp.Lt, "<"],
        [ComparisonOp.Lte, "<="], [ComparisonOp.Gt, ">"], [ComparisonOp.Gte, ">="],
    ]);
    private static readonly ArithmeticSymbols: ReadonlyMap<ArithmeticOp, string> = new Map([
        [ArithmeticOp.Add, "+"], [ArithmeticOp.Sub, "-"], [ArithmeticOp.Mul, "*"],
        [ArithmeticOp.Div, "/"], [ArithmeticOp.Mod, "%"],
    ]);

    public Text(model: CypherQueryModel): string
    {
        return model.Parts.map((p) => this.Part(p)).join(CypherUnparser.Space);
    }

    private Part(part: QueryPart): string
    {
        const pieces = part.Reading.map((r) => this.Reading(r));
        pieces.push(this.Projection(part.Projection));
        return pieces.join(CypherUnparser.Space);
    }

    private Reading(clause: ReadingClause): string
    {
        if (clause instanceof MatchClause) return this.Match(clause);
        if (clause instanceof UnwindClause) return this.Unwind(clause);
        throw new CypherSemanticError(clause.constructor.name);
    }

    private Match(clause: MatchClause): string
    {
        const head = clause.Optional ? `${CypherUnparser.KwOptional} ${CypherUnparser.KwMatch}` : CypherUnparser.KwMatch;
        const paths = clause.Paths.map((p) => this.Path(p)).join(CypherUnparser.Comma);
        return `${head} ${paths}${this.Where(clause.Where)}`;
    }

    private Unwind(clause: UnwindClause): string
    {
        return `${CypherUnparser.KwUnwind} ${this.Expr(clause.Expr, Prec.Or)} ${CypherUnparser.KwAs} ${clause.Variable}`;
    }

    // Leading-space-prefixed so an absent WHERE contributes nothing.
    private Where(where: WhereClause | undefined): string
    {
        return where === undefined ? CypherUnparser.Empty : ` ${CypherUnparser.KwWhere} ${this.Expr(where.Predicate, Prec.Or)}`;
    }

    private Projection(p: ProjectionClause): string
    {
        let out = p.IsReturn ? CypherUnparser.KwReturn : CypherUnparser.KwWith;
        if (p.Distinct) out += ` ${CypherUnparser.KwDistinct}`;
        out += ` ${p.Items.map((i) => this.ReturnItem(i)).join(CypherUnparser.Comma)}`;
        out += this.Where(p.Where);
        if (p.OrderBy !== undefined && p.OrderBy.length > 0)
        {
            out += ` ${CypherUnparser.KwOrderBy} ${p.OrderBy.map((s) => this.Sort(s)).join(CypherUnparser.Comma)}`;
        }
        if (p.Skip !== undefined) out += ` ${CypherUnparser.KwSkip} ${this.Expr(p.Skip, Prec.Or)}`;
        if (p.Limit !== undefined) out += ` ${CypherUnparser.KwLimit} ${this.Expr(p.Limit, Prec.Or)}`;
        return out;
    }

    private ReturnItem(item: ReturnItem): string
    {
        const expr = this.Expr(item.Expr, Prec.Or);
        return item.Alias === undefined ? expr : `${expr} ${CypherUnparser.KwAs} ${item.Alias}`;
    }

    private Sort(item: SortItem): string
    {
        const expr = this.Expr(item.Expr, Prec.Or);
        return item.Descending ? `${expr} ${CypherUnparser.KwDesc}` : expr;
    }

    private Path(path: PatternPath): string
    {
        let out = path.PathVariable === undefined ? CypherUnparser.Empty : `${path.PathVariable} ${CypherUnparser.Equals} `;
        out += this.Node(path.Nodes[0]!);
        for (let i = 0; i < path.Rels.length; i++)
        {
            out += this.Rel(path.Rels[i]!) + this.Node(path.Nodes[i + 1]!);
        }
        return out;
    }

    // A qualified label (shop.Customer) is rendered verbatim as :ns.Concept.
    private Node(node: NodePattern): string
    {
        let out = CypherUnparser.OpenParen + (node.Variable ?? CypherUnparser.Empty);
        if (node.Label !== undefined) out += CypherUnparser.Colon + node.Label;
        if (node.Properties.size > 0) out += CypherUnparser.Space + this.PropMap(node.Properties);
        return out + CypherUnparser.CloseParen;
    }

    private Rel(rel: RelPattern): string
    {
        const left = rel.Direction === RelDirection.Incoming ? CypherUnparser.ArrowLeft + CypherUnparser.Dash : CypherUnparser.Dash;
        const right = rel.Direction === RelDirection.Outgoing ? CypherUnparser.Dash + CypherUnparser.ArrowRight : CypherUnparser.Dash;
        let inner = rel.Variable ?? CypherUnparser.Empty;
        if (rel.RelType !== undefined) inner += CypherUnparser.Colon + rel.RelType;
        if (rel.IsVariableLength) inner += this.Hops(rel);
        if (rel.Properties.size > 0) inner += CypherUnparser.Space + this.PropMap(rel.Properties);
        const bracket = inner.length === 0 ? CypherUnparser.Empty : CypherUnparser.OpenBracket + inner + CypherUnparser.CloseBracket;
        return left + bracket + right;
    }

    private Hops(rel: RelPattern): string
    {
        const min = rel.MinHops ?? 1;
        if (rel.MaxHops === undefined) return min === 1 ? CypherUnparser.Star : `${CypherUnparser.Star}${min}${CypherUnparser.RangeDots}`;
        if (rel.MaxHops === min) return `${CypherUnparser.Star}${min}`;
        return `${CypherUnparser.Star}${min}${CypherUnparser.RangeDots}${rel.MaxHops}`;
    }

    private PropMap(props: ReadonlyMap<string, Scalar>): string
    {
        const entries = [...props].map(([k, v]) => `${k}${CypherUnparser.KeyValueSeparator}${this.Scalar(v)}`);
        return CypherUnparser.OpenBrace + entries.join(CypherUnparser.Comma) + CypherUnparser.CloseBrace;
    }

    // Renders `e`, parenthesizing it when it binds looser than the context requires.
    private Expr(e: Expression, minPrec: Prec): string
    {
        const prec = this.PrecOf(e);
        const text = this.ExprBare(e);
        return prec < minPrec ? CypherUnparser.OpenParen + text + CypherUnparser.CloseParen : text;
    }

    private PrecOf(e: Expression): Prec
    {
        if (e instanceof BooleanExpression) return this.BooleanPrec(e);
        if (e instanceof Comparison || e instanceof IsNullExpression || e instanceof InExpression) return Prec.Predicate;
        if (e instanceof ArithmeticExpression) return e.Op === ArithmeticOp.Add || e.Op === ArithmeticOp.Sub ? Prec.Additive : Prec.Multiplicative;
        if (e instanceof UnaryMinus) return Prec.Unary;
        if (e instanceof Literal && typeof e.Value === "number" && e.Value < 0) return Prec.Unary;
        return Prec.Postfix;
    }

    private BooleanPrec(e: BooleanExpression): Prec
    {
        if (e.Op === BooleanOp.Or) return Prec.Or;
        return e.Op === BooleanOp.And ? Prec.And : Prec.Not;
    }

    private ExprBare(e: Expression): string
    {
        if (e instanceof Literal) return e.Value === null ? CypherUnparser.KwNull : this.Scalar(e.Value);
        if (e instanceof VariableRef) return e.Variable;
        if (e instanceof PropertyAccess) return e.Variable + CypherUnparser.Dot + e.Property;
        if (e instanceof Parameter) return CypherUnparser.Dollar + e.Name;
        if (e instanceof Comparison) return this.ComparisonText(e);
        if (e instanceof BooleanExpression) return this.BooleanText(e);
        if (e instanceof IsNullExpression) return `${this.Expr(e.Operand, Prec.Additive)} ${e.Negated ? CypherUnparser.KwIsNotNull : CypherUnparser.KwIsNull}`;
        if (e instanceof InExpression) return this.InText(e);
        if (e instanceof ArithmeticExpression) return this.ArithmeticText(e);
        if (e instanceof UnaryMinus) return CypherUnparser.Dash + this.Expr(e.Operand, Prec.Postfix);
        if (e instanceof ListLiteral) return CypherUnparser.OpenBracket + e.Items.map((i) => this.Expr(i, Prec.Or)).join(CypherUnparser.Comma) + CypherUnparser.CloseBracket;
        if (e instanceof MapLiteral) return this.MapText(e);
        if (e instanceof IndexAccess) return this.Expr(e.Target, Prec.Postfix) + CypherUnparser.OpenBracket + this.Expr(e.Index, Prec.Or) + CypherUnparser.CloseBracket;
        if (e instanceof FunctionCall) return this.CallText(e);
        // Unreachable from the public fluent builder/parser (ValueLiteral is only constructed directly in tests): defensive, not a round-trip gap.
        if (e instanceof ValueLiteral) throw new CypherSemanticError(CypherUnparser.UnsupportedValueLiteral);
        throw new CypherSemanticError(e.constructor.name);
    }

    private ComparisonText(e: Comparison): string
    {
        return `${this.Expr(e.Left, Prec.Additive)} ${CypherUnparser.ComparisonSymbols.get(e.Op)!} ${this.Expr(e.Right, Prec.Additive)}`;
    }

    // Operands after the first need strictly tighter binding than a same-level child to preserve left associativity.
    private BooleanText(e: BooleanExpression): string
    {
        if (e.Op === BooleanOp.Not) return `${CypherUnparser.KwNot} ${this.Expr(e.Operands[0]!, Prec.Not)}`;
        const own = this.BooleanPrec(e);
        const word = e.Op === BooleanOp.And ? CypherUnparser.KwAnd : CypherUnparser.KwOr;
        return e.Operands.map((o, i) => this.Expr(o, i === 0 ? own : own + 1)).join(` ${word} `);
    }

    private InText(e: InExpression): string
    {
        const items = e.List.map((i) =>
        {
            if (!(i instanceof Literal) || i.Value === null) throw new CypherSemanticError(CypherUnparser.UnsupportedInItem);
            return this.Scalar(i.Value);
        });
        return `${this.Expr(e.Operand, Prec.Additive)} ${CypherUnparser.KwIn} ${CypherUnparser.OpenBracket}${items.join(CypherUnparser.Comma)}${CypherUnparser.CloseBracket}`;
    }

    private ArithmeticText(e: ArithmeticExpression): string
    {
        const own = this.PrecOf(e);
        return `${this.Expr(e.Left, own)} ${CypherUnparser.ArithmeticSymbols.get(e.Op)!} ${this.Expr(e.Right, own + 1)}`;
    }

    private MapText(e: MapLiteral): string
    {
        const entries = [...e.Entries].map(([k, v]) => `${k}${CypherUnparser.KeyValueSeparator}${this.Expr(v, Prec.Or)}`);
        return CypherUnparser.OpenBrace + entries.join(CypherUnparser.Comma) + CypherUnparser.CloseBrace;
    }

    private CallText(e: FunctionCall): string
    {
        if (e.Star) return `${e.Name}${CypherUnparser.OpenParen}${CypherUnparser.Star}${CypherUnparser.CloseParen}`;
        const args = e.Args.map((a) => this.Expr(a, Prec.Or)).join(CypherUnparser.Comma);
        const distinct = e.Distinct ? `${CypherUnparser.KwDistinct} ` : CypherUnparser.Empty;
        return `${e.Name}${CypherUnparser.OpenParen}${distinct}${args}${CypherUnparser.CloseParen}`;
    }

    private Scalar(value: Scalar | null): string
    {
        if (value === null) throw new CypherSemanticError(CypherUnparser.UnsupportedNullScalar);
        if (typeof value === "string") return CypherUnparser.Quote + value.split(CypherUnparser.Quote).join(CypherUnparser.EscapedQuote) + CypherUnparser.Quote;
        if (typeof value === "boolean") return value ? CypherUnparser.KwTrue : CypherUnparser.KwFalse;
        return this.Number(value);
    }

    // The lexer reads plain decimals only (no exponent), so exponent-form numbers are expanded digit-by-digit from the
    // shortest round-trip representation. NaN and Infinity have no text form.
    private Number(n: number): string
    {
        if (!Number.isFinite(n)) throw new CypherSemanticError(CypherUnparser.UnsupportedNumber + String(n));
        const text = String(n);
        const match = CypherUnparser.ExponentPattern.exec(text);
        if (match === null) return text;
        const sign = match[1]!;
        const whole = match[2]!;
        const fraction = match[3] ?? CypherUnparser.Empty;
        const exponent = Number(match[4]!);
        const digits = whole + fraction;
        const point = whole.length + exponent;
        if (point <= 0) return sign + CypherUnparser.Zero + CypherUnparser.Dot + CypherUnparser.Zero.repeat(-point) + digits;
        if (point >= digits.length) return sign + digits + CypherUnparser.Zero.repeat(point - digits.length);
        return sign + digits.slice(0, point) + CypherUnparser.Dot + digits.slice(point);
    }
}
