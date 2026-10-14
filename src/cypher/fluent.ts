import type { Scalar } from "../manifest/logical.js";
import { CypherSemanticError } from "./errors.js";
import { RelDirection, ComparisonOp, ArithmeticOp } from "./enums.js";
import { NodePattern, RelPattern, PatternPath } from "./patterns.js";
import { CypherQueryModel, MatchClause, WhereClause, ProjectionClause, QueryPart, ReturnItem, ReadingClause, UnwindClause, SortItem } from "./query-model.js";
import { Expression, VariableRef, PropertyAccess, Literal, Comparison, FunctionCall, ListLiteral, MapLiteral, IndexAccess, ArithmeticExpression } from "./expressions.js";

// Variable-length relationship bounds.
export class Hops
{
    private static readonly InvalidRangeMessage = "Hops.Range requires min <= max";

    private constructor(public readonly Min: number, public readonly Max: number | undefined)
    {
    }

    // Explicit bounds, like *min..max.
    public static Range(min: number, max: number): Hops
    {
        if (min > max) throw new CypherSemanticError(`${Hops.InvalidRangeMessage}: ${min}..${max}`);
        return new Hops(min, max);
    }

    // Unbounded, like *.
    public static Any(): Hops
    {
        return new Hops(1, undefined);
    }

    // At least min hops, unbounded above, like *min..
    public static AtLeast(min: number): Hops
    {
        return new Hops(min, undefined);
    }

    // Exactly n hops, like *n.
    public static Exactly(n: number): Hops
    {
        return new Hops(n, n);
    }
}

class PendingRel
{
    constructor(
        public readonly RelType: string | undefined,
        public readonly Direction: RelDirection,
        public readonly Target: NodeBuilder,
        public readonly Length: Hops | undefined,
    )
    {
    }
}

export class NodeBuilder
{
    private label: string | undefined;
    private readonly props = new Map<string, Scalar>();
    private readonly rels: PendingRel[] = [];
    private pathVariable: string | undefined;

    constructor(private readonly variable: string | undefined)
    {
    }

    public Label(label: string): NodeBuilder
    {
        this.label = label;
        return this;
    }

    public Prop(key: string, value: Scalar): NodeBuilder
    {
        this.props.set(key, value);
        return this;
    }

    public Out(relType: string, target: NodeBuilder, length?: Hops): NodeBuilder
    {
        this.rels.push(new PendingRel(relType, RelDirection.Outgoing, target, length));
        return this;
    }

    public In(relType: string, target: NodeBuilder, length?: Hops): NodeBuilder
    {
        this.rels.push(new PendingRel(relType, RelDirection.Incoming, target, length));
        return this;
    }

    public Undirected(relType: string, target: NodeBuilder, length?: Hops): NodeBuilder
    {
        this.rels.push(new PendingRel(relType, RelDirection.Undirected, target, length));
        return this;
    }

    // Binds the whole path rooted at this anchor to a path variable (MATCH p = ...).
    public AsPath(pathVariable: string): NodeBuilder
    {
        this.pathVariable = pathVariable;
        return this;
    }

    public BuildPath(): PatternPath
    {
        const nodes: NodePattern[] = [];
        const rels: RelPattern[] = [];
        let cursor: NodeBuilder = this;
        for (;;)
        {
            nodes.push(new NodePattern(cursor.variable, cursor.label, cursor.props));
            const step = cursor.rels[0];
            if (step === undefined) break;
            rels.push(new RelPattern(undefined, step.RelType, step.Direction, new Map(), step.Length?.Min, step.Length?.Max));
            cursor = step.Target;
        }
        return new PatternPath(nodes, rels, this.pathVariable);
    }
}

export class Pattern
{
    public static Node(variable?: string): NodeBuilder
    {
        return new NodeBuilder(variable);
    }
}

export type ExprArg = Expression | ExprBuilder;

export class ExprBuilder
{
    constructor(public readonly Inner: Expression)
    {
    }

    public static Unwrap(arg: ExprArg): Expression
    {
        return arg instanceof ExprBuilder ? arg.Inner : arg;
    }

    public Eq(value: Scalar): Expression
    {
        return new Comparison(this.Inner, ComparisonOp.Eq, new Literal(value));
    }

    public Lt(value: Scalar): Expression
    {
        return new Comparison(this.Inner, ComparisonOp.Lt, new Literal(value));
    }

    public Gt(value: Scalar): Expression
    {
        return new Comparison(this.Inner, ComparisonOp.Gt, new Literal(value));
    }

    public Add(other: ExprArg): ExprBuilder
    {
        return this.Arith(ArithmeticOp.Add, other);
    }

    public Sub(other: ExprArg): ExprBuilder
    {
        return this.Arith(ArithmeticOp.Sub, other);
    }

    public Mul(other: ExprArg): ExprBuilder
    {
        return this.Arith(ArithmeticOp.Mul, other);
    }

    public Div(other: ExprArg): ExprBuilder
    {
        return this.Arith(ArithmeticOp.Div, other);
    }

    public Mod(other: ExprArg): ExprBuilder
    {
        return this.Arith(ArithmeticOp.Mod, other);
    }

    // list[index] / map[key].
    public At(index: ExprArg): ExprBuilder
    {
        return new ExprBuilder(new IndexAccess(this.Inner, ExprBuilder.Unwrap(index)));
    }

    // As a projection item (WITH/RETURN), optionally aliased.
    public As(alias?: string): ReturnItem
    {
        return new ReturnItem(this.Inner, alias);
    }

    public Asc(): SortItem
    {
        return new SortItem(this.Inner, false);
    }

    public Desc(): SortItem
    {
        return new SortItem(this.Inner, true);
    }

    private Arith(op: ArithmeticOp, other: ExprArg): ExprBuilder
    {
        return new ExprBuilder(new ArithmeticExpression(this.Inner, op, ExprBuilder.Unwrap(other)));
    }
}

export class Expr
{
    public static Prop(variable: string, property: string): ExprBuilder
    {
        return new ExprBuilder(new PropertyAccess(variable, property));
    }

    public static Var(variable: string): ExprBuilder
    {
        return new ExprBuilder(new VariableRef(variable));
    }

    public static Lit(value: Scalar): ExprBuilder
    {
        return new ExprBuilder(new Literal(value));
    }

    public static List(...items: ExprArg[]): ExprBuilder
    {
        return new ExprBuilder(new ListLiteral(items.map((i) => ExprBuilder.Unwrap(i))));
    }

    public static Map(entries: Readonly<Record<string, ExprArg>>): ExprBuilder
    {
        const map = new Map<string, Expression>();
        for (const [key, value] of Object.entries(entries)) map.set(key, ExprBuilder.Unwrap(value));
        return new ExprBuilder(new MapLiteral(map));
    }
}

// Function and aggregate call builders.
export class Fn
{
    private static readonly CountName = "count";
    private static readonly CollectName = "collect";
    private static readonly SumName = "sum";
    private static readonly AvgName = "avg";
    private static readonly MinName = "min";
    private static readonly MaxName = "max";
    private static readonly CoalesceName = "coalesce";

    // count(*)
    public static Count(): ExprBuilder
    {
        return new ExprBuilder(new FunctionCall(Fn.CountName, [], false, true));
    }

    public static CountOf(arg: ExprArg): ExprBuilder
    {
        return Fn.Call(Fn.CountName, arg);
    }

    public static CountDistinct(arg: ExprArg): ExprBuilder
    {
        return new ExprBuilder(new FunctionCall(Fn.CountName, [ExprBuilder.Unwrap(arg)], true, false));
    }

    public static Collect(arg: ExprArg): ExprBuilder
    {
        return Fn.Call(Fn.CollectName, arg);
    }

    public static Sum(arg: ExprArg): ExprBuilder
    {
        return Fn.Call(Fn.SumName, arg);
    }

    public static Avg(arg: ExprArg): ExprBuilder
    {
        return Fn.Call(Fn.AvgName, arg);
    }

    public static Min(arg: ExprArg): ExprBuilder
    {
        return Fn.Call(Fn.MinName, arg);
    }

    public static Max(arg: ExprArg): ExprBuilder
    {
        return Fn.Call(Fn.MaxName, arg);
    }

    public static Coalesce(...args: ExprArg[]): ExprBuilder
    {
        return Fn.Call(Fn.CoalesceName, ...args);
    }

    // Any registered function by name.
    public static Call(name: string, ...args: ExprArg[]): ExprBuilder
    {
        return new ExprBuilder(new FunctionCall(name, args.map((a) => ExprBuilder.Unwrap(a)), false, false));
    }
}

export class Sort
{
    public static By(expr: ExprArg, descending: boolean = false): SortItem
    {
        return new SortItem(ExprBuilder.Unwrap(expr), descending);
    }
}

export class Return
{
    public static Node(variable: string): ReturnItem
    {
        return new ReturnItem(new VariableRef(variable), undefined);
    }

    public static Prop(variable: string, property: string, alias?: string): ReturnItem
    {
        return new ReturnItem(new PropertyAccess(variable, property), alias);
    }

    public static Item(expr: ExprArg, alias?: string): ReturnItem
    {
        return new ReturnItem(ExprBuilder.Unwrap(expr), alias);
    }
}

class PendingProjection
{
    public Distinct = false;
    public OrderBy: readonly SortItem[] | undefined;
    public Skip: Expression | undefined;
    public Limit: Expression | undefined;
    public Where: WhereClause | undefined;

    constructor(public readonly Items: readonly ReturnItem[], public readonly IsReturn: boolean)
    {
    }

    public Build(): ProjectionClause
    {
        return new ProjectionClause(this.Items, this.Distinct, this.OrderBy, this.Skip, this.Limit, this.IsReturn, this.Where);
    }
}

export class CypherQuery
{
    private static readonly MissingReturnMessage = "CypherQuery requires a Return clause";
    private static readonly AfterReturnMessage = "no clauses may follow Return";
    private static readonly NoProjectionMessage = "projection modifier requires a preceding With or Return";
    private static readonly WhereNeedsMatchMessage = "Where must directly follow a Match or OptionalMatch";
    private static readonly DuplicateWhereMessage = "Where was already specified for this Match";
    private static readonly DuplicateWithWhereMessage = "Where was already specified for this With";

    private readonly parts: QueryPart[] = [];
    private reading: ReadingClause[] = [];
    private projection: PendingProjection | undefined;

    private constructor()
    {
    }

    public static Match(...anchors: NodeBuilder[]): CypherQuery
    {
        return new CypherQuery().Match(...anchors);
    }

    public static OptionalMatch(...anchors: NodeBuilder[]): CypherQuery
    {
        return new CypherQuery().OptionalMatch(...anchors);
    }

    public static Unwind(expr: ExprArg, variable: string): CypherQuery
    {
        return new CypherQuery().Unwind(expr, variable);
    }

    public Match(...anchors: NodeBuilder[]): CypherQuery
    {
        return this.AddReading(new MatchClause(anchors.map((a) => a.BuildPath()), undefined, false));
    }

    public OptionalMatch(...anchors: NodeBuilder[]): CypherQuery
    {
        return this.AddReading(new MatchClause(anchors.map((a) => a.BuildPath()), undefined, true));
    }

    public Unwind(expr: ExprArg, variable: string): CypherQuery
    {
        return this.AddReading(new UnwindClause(ExprBuilder.Unwrap(expr), variable));
    }

    // After a WITH, sets that projection's post-projection predicate; otherwise attaches to the preceding Match.
    public Where(expr: ExprArg): CypherQuery
    {
        if (this.projection !== undefined && !this.projection.IsReturn)
        {
            if (this.projection.Where !== undefined) throw new Error(CypherQuery.DuplicateWithWhereMessage);
            this.projection.Where = new WhereClause(ExprBuilder.Unwrap(expr));
            return this;
        }
        const last = this.reading[this.reading.length - 1];
        if (this.projection !== undefined || !(last instanceof MatchClause)) throw new Error(CypherQuery.WhereNeedsMatchMessage);
        if (last.Where !== undefined) throw new Error(CypherQuery.DuplicateWhereMessage);
        this.reading[this.reading.length - 1] = new MatchClause(last.Paths, new WhereClause(ExprBuilder.Unwrap(expr)), last.Optional);
        return this;
    }

    // Ends the current query part with a WITH projection; further readings start the next part.
    public With(...items: ReturnItem[]): CypherQuery
    {
        this.CloseWith();
        this.projection = new PendingProjection(items, false);
        return this;
    }

    public Return(...items: ReturnItem[]): CypherQuery
    {
        this.CloseWith();
        this.projection = new PendingProjection(items, true);
        return this;
    }

    public Distinct(): CypherQuery
    {
        this.RequireProjection().Distinct = true;
        return this;
    }

    public OrderBy(...items: SortItem[]): CypherQuery
    {
        this.RequireProjection().OrderBy = items;
        return this;
    }

    public Skip(n: number): CypherQuery
    {
        this.RequireProjection().Skip = new Literal(n);
        return this;
    }

    public Limit(n: number): CypherQuery
    {
        this.RequireProjection().Limit = new Literal(n);
        return this;
    }

    public ToModel(): CypherQueryModel
    {
        if (this.projection === undefined || !this.projection.IsReturn) throw new Error(CypherQuery.MissingReturnMessage);
        return new CypherQueryModel([...this.parts, new QueryPart([...this.reading], this.projection.Build())]);
    }

    private AddReading(clause: ReadingClause): CypherQuery
    {
        this.CloseWith();
        this.reading.push(clause);
        return this;
    }

    // A pending WITH ends its query part when anything follows it; a pending RETURN ends the query.
    private CloseWith(): void
    {
        if (this.projection === undefined) return;
        if (this.projection.IsReturn) throw new Error(CypherQuery.AfterReturnMessage);
        this.parts.push(new QueryPart(this.reading, this.projection.Build()));
        this.reading = [];
        this.projection = undefined;
    }

    private RequireProjection(): PendingProjection
    {
        if (this.projection === undefined) throw new Error(CypherQuery.NoProjectionMessage);
        return this.projection;
    }
}
