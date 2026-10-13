import type { Scalar } from "../manifest/logical.js";
import { RelDirection, ComparisonOp } from "./enums.js";
import { NodePattern, RelPattern, PatternPath } from "./patterns.js";
import { CypherQueryModel, MatchClause, WhereClause, ReturnClause, ReturnItem } from "./query-model.js";
import { Expression, VariableRef, PropertyAccess, Literal, Comparison } from "./expressions.js";

class PendingRel
{
    constructor(public readonly RelType: string | undefined, public readonly Direction: RelDirection, public readonly Target: NodeBuilder)
    {
    }
}

export class NodeBuilder
{
    private label: string | undefined;
    private readonly props = new Map<string, Scalar>();
    private readonly rels: PendingRel[] = [];

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

    public Out(relType: string, target: NodeBuilder): NodeBuilder
    {
        this.rels.push(new PendingRel(relType, RelDirection.Outgoing, target));
        return this;
    }

    public In(relType: string, target: NodeBuilder): NodeBuilder
    {
        this.rels.push(new PendingRel(relType, RelDirection.Incoming, target));
        return this;
    }

    public Undirected(relType: string, target: NodeBuilder): NodeBuilder
    {
        this.rels.push(new PendingRel(relType, RelDirection.Undirected, target));
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
            rels.push(new RelPattern(undefined, step.RelType, step.Direction, new Map()));
            cursor = step.Target;
        }
        return new PatternPath(nodes, rels);
    }
}

export class Pattern
{
    public static Node(variable?: string): NodeBuilder
    {
        return new NodeBuilder(variable);
    }
}

export class ExprBuilder
{
    constructor(public readonly Inner: Expression)
    {
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
}

export class CypherQuery
{
    private static readonly MissingReturnMessage = "CypherQuery requires a Return clause";

    private whereClause: WhereClause | undefined;
    private returnClause: ReturnClause | undefined;

    private constructor(private readonly paths: readonly PatternPath[])
    {
    }

    public static Match(...anchors: NodeBuilder[]): CypherQuery
    {
        return new CypherQuery(anchors.map((a) => a.BuildPath()));
    }

    public Where(expr: Expression): CypherQuery
    {
        this.whereClause = new WhereClause(expr);
        return this;
    }

    public Return(...items: ReturnItem[]): CypherQuery
    {
        this.returnClause = new ReturnClause(items);
        return this;
    }

    public ToModel(): CypherQueryModel
    {
        if (this.returnClause === undefined) throw new Error(CypherQuery.MissingReturnMessage);
        return new CypherQueryModel(new MatchClause(this.paths), this.whereClause, this.returnClause);
    }
}
