import type { Scalar } from "../manifest/logical.js";
import { ComparisonOp, BooleanOp, ArithmeticOp } from "./enums.js";
import { EvalContext } from "./binding.js";
import { CypherValue, ScalarValue, NullValue, NodeValue } from "./values.js";
import { CypherSemanticError } from "./errors.js";
import { ListValue, MapValue } from "./values-structured.js";
import { FunctionRegistry } from "./functions.js";

export abstract class Expression
{
    public abstract Evaluate(ctx: EvalContext): CypherValue;
    public abstract DefaultName(): string;

    public CollectVariables(into: Set<string>): void
    {
        // Leaf expressions with no variables override nothing.
    }

    public ContainsAggregate(): boolean
    {
        // Leaf and non-composite expressions carry no aggregate by default.
        return false;
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
        if (target instanceof MapValue) return target.Get(this.Property) ?? NullValue.Instance;
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

export class ValueLiteral extends Expression
{
    private static readonly Label = "value";

    constructor(private readonly value: CypherValue)
    {
        super();
    }

    public Evaluate(): CypherValue
    {
        return this.value;
    }

    public DefaultName(): string
    {
        return ValueLiteral.Label;
    }

    public CollectVariables(): void
    {
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

    public override ContainsAggregate(): boolean
    {
        return this.left.ContainsAggregate() || this.right.ContainsAggregate();
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

    public override ContainsAggregate(): boolean
    {
        return this.operands.some((o) => o.ContainsAggregate());
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

    public override ContainsAggregate(): boolean
    {
        return this.operand.ContainsAggregate();
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

    public override ContainsAggregate(): boolean
    {
        return this.operand.ContainsAggregate() || this.list.some((e) => e.ContainsAggregate());
    }
}

export class ArithmeticExpression extends Expression
{
    private static readonly Label = "arithmetic";

    constructor(private readonly left: Expression, private readonly op: ArithmeticOp, private readonly right: Expression)
    {
        super();
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        const l = this.left.Evaluate(ctx);
        const r = this.right.Evaluate(ctx);
        if (!(l instanceof ScalarValue) || !(r instanceof ScalarValue)) return NullValue.Instance;
        const a = l.Value;
        const b = r.Value;
        if (typeof a === "number" && typeof b === "number") return ArithmeticExpression.ApplyNumbers(a, this.op, b);
        if (this.op === ArithmeticOp.Add && typeof a === "string" && typeof b === "string") return new ScalarValue(a + b);
        return NullValue.Instance;
    }

    private static ApplyNumbers(a: number, op: ArithmeticOp, b: number): CypherValue
    {
        switch (op)
        {
            case ArithmeticOp.Add: return new ScalarValue(a + b);
            case ArithmeticOp.Sub: return new ScalarValue(a - b);
            case ArithmeticOp.Mul: return new ScalarValue(a * b);
            case ArithmeticOp.Div: return b === 0 ? NullValue.Instance : new ScalarValue(a / b);
            case ArithmeticOp.Mod: return b === 0 ? NullValue.Instance : new ScalarValue(a % b);
        }
        return NullValue.Instance;
    }

    public DefaultName(): string
    {
        return ArithmeticExpression.Label;
    }

    public CollectVariables(into: Set<string>): void
    {
        this.left.CollectVariables(into);
        this.right.CollectVariables(into);
    }

    public override ContainsAggregate(): boolean
    {
        return this.left.ContainsAggregate() || this.right.ContainsAggregate();
    }
}

export class UnaryMinus extends Expression
{
    private static readonly Label = "negate";

    constructor(private readonly operand: Expression)
    {
        super();
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        const v = this.operand.Evaluate(ctx);
        if (v instanceof ScalarValue && typeof v.Value === "number") return new ScalarValue(-v.Value);
        return NullValue.Instance;
    }

    public DefaultName(): string
    {
        return UnaryMinus.Label;
    }

    public CollectVariables(into: Set<string>): void
    {
        this.operand.CollectVariables(into);
    }

    public override ContainsAggregate(): boolean
    {
        return this.operand.ContainsAggregate();
    }
}

export class ListLiteral extends Expression
{
    private static readonly Label = "list";

    constructor(private readonly items: readonly Expression[])
    {
        super();
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        return new ListValue(this.items.map((i) => i.Evaluate(ctx)));
    }

    public DefaultName(): string
    {
        return ListLiteral.Label;
    }

    public CollectVariables(into: Set<string>): void
    {
        for (const i of this.items) i.CollectVariables(into);
    }

    public override ContainsAggregate(): boolean
    {
        return this.items.some((i) => i.ContainsAggregate());
    }
}

export class MapLiteral extends Expression
{
    private static readonly Label = "map";

    constructor(private readonly entries: ReadonlyMap<string, Expression>)
    {
        super();
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        const out = new Map<string, CypherValue>();
        for (const [k, e] of this.entries) out.set(k, e.Evaluate(ctx));
        return new MapValue(out);
    }

    public DefaultName(): string
    {
        return MapLiteral.Label;
    }

    public CollectVariables(into: Set<string>): void
    {
        for (const e of this.entries.values()) e.CollectVariables(into);
    }

    public override ContainsAggregate(): boolean
    {
        for (const e of this.entries.values()) if (e.ContainsAggregate()) return true;
        return false;
    }
}

export class IndexAccess extends Expression
{
    private static readonly Label = "index";

    constructor(private readonly target: Expression, private readonly index: Expression)
    {
        super();
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        const t = this.target.Evaluate(ctx);
        const i = this.index.Evaluate(ctx);
        if (!(i instanceof ScalarValue)) return NullValue.Instance;
        if (t instanceof ListValue && typeof i.Value === "number" && Number.isInteger(i.Value))
        {
            return t.Items[i.Value] ?? NullValue.Instance;
        }
        if (t instanceof MapValue && typeof i.Value === "string") return t.Get(i.Value) ?? NullValue.Instance;
        return NullValue.Instance;
    }

    public DefaultName(): string
    {
        return IndexAccess.Label;
    }

    public CollectVariables(into: Set<string>): void
    {
        this.target.CollectVariables(into);
        this.index.CollectVariables(into);
    }

    public override ContainsAggregate(): boolean
    {
        return this.target.ContainsAggregate() || this.index.ContainsAggregate();
    }
}

export class FunctionCall extends Expression
{
    private static readonly AggregateOutside = "aggregate function outside a projection: ";
    private static readonly UnknownFunction = "unknown function: ";

    constructor(public readonly Name: string, public readonly Args: readonly Expression[], public readonly Distinct: boolean, public readonly Star: boolean)
    {
        super();
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        const lower = this.Name.toLowerCase();
        if (FunctionRegistry.IsAggregate(lower)) throw new CypherSemanticError(`${FunctionCall.AggregateOutside}${this.Name}`);
        const fn = FunctionRegistry.Scalar(lower);
        if (fn === undefined) throw new CypherSemanticError(`${FunctionCall.UnknownFunction}${this.Name}`);
        return fn.Invoke(this.Args.map((a) => a.Evaluate(ctx)));
    }

    public DefaultName(): string
    {
        return this.Name;
    }

    public CollectVariables(into: Set<string>): void
    {
        for (const a of this.Args) a.CollectVariables(into);
    }

    public override ContainsAggregate(): boolean
    {
        return FunctionRegistry.IsAggregate(this.Name.toLowerCase()) || this.Args.some((a) => a.ContainsAggregate());
    }
}
