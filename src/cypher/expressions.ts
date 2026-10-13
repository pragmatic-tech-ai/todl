import type { Scalar } from "../manifest/logical.js";
import { ComparisonOp, BooleanOp } from "./enums.js";
import { EvalContext } from "./binding.js";
import { CypherValue, ScalarValue, NullValue, NodeValue } from "./values.js";
import { CypherSemanticError } from "./errors.js";

export abstract class Expression
{
    public abstract Evaluate(ctx: EvalContext): CypherValue;
    public abstract DefaultName(): string;

    public CollectVariables(into: Set<string>): void
    {
        // Leaf expressions with no variables override nothing.
    }
}

export class VariableRef extends Expression
{
    constructor(public readonly Variable: string)
    {
        super();
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        return ctx.Binding.Get(this.Variable) ?? NullValue.Instance;
    }

    public DefaultName(): string
    {
        return this.Variable;
    }

    public CollectVariables(into: Set<string>): void
    {
        into.add(this.Variable);
    }
}

export class PropertyAccess extends Expression
{
    private static readonly Separator = ".";

    constructor(public readonly Variable: string, public readonly Property: string)
    {
        super();
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        const target = ctx.Binding.Get(this.Variable);
        if (!(target instanceof NodeValue)) return NullValue.Instance;
        const value = target.Field(this.Property);
        return value === undefined ? NullValue.Instance : new ScalarValue(value);
    }

    public DefaultName(): string
    {
        return `${this.Variable}${PropertyAccess.Separator}${this.Property}`;
    }

    public CollectVariables(into: Set<string>): void
    {
        into.add(this.Variable);
    }
}

export class Literal extends Expression
{
    constructor(private readonly value: Scalar | null)
    {
        super();
    }

    public Evaluate(): CypherValue
    {
        return this.value === null ? NullValue.Instance : new ScalarValue(this.value);
    }

    public DefaultName(): string
    {
        return String(this.value);
    }
}

export class Parameter extends Expression
{
    private static readonly MissingPrefix = "parameter $";

    constructor(public readonly Name: string)
    {
        super();
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        const value = ctx.Parameters.get(this.Name);
        if (value === undefined) throw new CypherSemanticError(`${Parameter.MissingPrefix}${this.Name} not supplied`);
        return new ScalarValue(value);
    }

    public DefaultName(): string
    {
        return `$${this.Name}`;
    }
}

export class Comparison extends Expression
{
    private static readonly Label = "comparison";
    private static readonly UnknownOp = "unknown comparison operator";

    constructor(private readonly left: Expression, private readonly op: ComparisonOp, private readonly right: Expression)
    {
        super();
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        const l = this.left.Evaluate(ctx);
        const r = this.right.Evaluate(ctx);
        if (!(l instanceof ScalarValue) || !(r instanceof ScalarValue)) return new ScalarValue(false);
        return new ScalarValue(Comparison.Apply(l.Value, this.op, r.Value));
    }

    private static Apply(l: Scalar, op: ComparisonOp, r: Scalar): boolean
    {
        if (typeof l !== typeof r) return false;
        switch (op)
        {
            case ComparisonOp.Eq: return l === r;
            case ComparisonOp.Neq: return l !== r;
            case ComparisonOp.Lt: return l < r;
            case ComparisonOp.Lte: return l <= r;
            case ComparisonOp.Gt: return l > r;
            case ComparisonOp.Gte: return l >= r;
        }
        throw new Error(Comparison.UnknownOp);
    }

    public DefaultName(): string
    {
        return Comparison.Label;
    }

    public CollectVariables(into: Set<string>): void
    {
        this.left.CollectVariables(into);
        this.right.CollectVariables(into);
    }
}

export class BooleanExpression extends Expression
{
    private static readonly Label = "boolean";
    private static readonly UnknownOp = "unknown boolean operator";

    constructor(private readonly op: BooleanOp, private readonly operands: readonly Expression[])
    {
        super();
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        switch (this.op)
        {
            case BooleanOp.Not: return new ScalarValue(!BooleanExpression.Truthy(this.operands[0]!.Evaluate(ctx)));
            case BooleanOp.And: return new ScalarValue(this.operands.every((o) => BooleanExpression.Truthy(o.Evaluate(ctx))));
            case BooleanOp.Or: return new ScalarValue(this.operands.some((o) => BooleanExpression.Truthy(o.Evaluate(ctx))));
        }
        throw new Error(BooleanExpression.UnknownOp);
    }

    public static Truthy(v: CypherValue): boolean
    {
        return v instanceof ScalarValue && v.Value === true;
    }

    public DefaultName(): string
    {
        return BooleanExpression.Label;
    }

    public CollectVariables(into: Set<string>): void
    {
        for (const o of this.operands) o.CollectVariables(into);
    }
}

export class IsNullExpression extends Expression
{
    private static readonly Label = "isNull";

    constructor(private readonly operand: Expression, private readonly negated: boolean)
    {
        super();
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        const isNull = this.operand.Evaluate(ctx) instanceof NullValue;
        return new ScalarValue(this.negated ? !isNull : isNull);
    }

    public DefaultName(): string
    {
        return IsNullExpression.Label;
    }

    public CollectVariables(into: Set<string>): void
    {
        this.operand.CollectVariables(into);
    }
}

export class InExpression extends Expression
{
    private static readonly Label = "in";

    constructor(private readonly operand: Expression, private readonly list: readonly Expression[])
    {
        super();
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        const v = this.operand.Evaluate(ctx);
        if (!(v instanceof ScalarValue)) return new ScalarValue(false);
        const found = this.list.some((e) =>
        {
            const x = e.Evaluate(ctx);
            return x instanceof ScalarValue && x.Value === v.Value;
        });
        return new ScalarValue(found);
    }

    public DefaultName(): string
    {
        return InExpression.Label;
    }

    public CollectVariables(into: Set<string>): void
    {
        this.operand.CollectVariables(into);
        for (const e of this.list) e.CollectVariables(into);
    }
}
