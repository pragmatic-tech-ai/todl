import type { Scalar } from "../manifest/logical.js";
import { ComparisonOp, BooleanOp, ArithmeticOp } from "./enums.js";
import { EvalContext } from "./binding.js";
import { CypherValue, ScalarValue, NullValue, NodeValue, NodeRefValue } from "./values.js";
import { CypherSemanticError } from "./errors.js";
import { ListValue, MapValue } from "./values-structured.js";
import { FunctionRegistry } from "./functions.js";

export abstract class Expression
{
    public abstract Evaluate(ctx: EvalContext): CypherValue;
    public abstract DefaultName(): string;
    // Canonical, prefix-tagged, recursive identity: equal keys iff structurally the same expression.
    public abstract StructuralKey(): string;
    // Top-down structural rewrite: replacer(node) wins (returned as-is, not recursed into); otherwise a NEW node of the
    // same type is built with each child rewritten. Never mutates.
    public abstract Rewrite(replacer: (e: Expression) => Expression | undefined): Expression;

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

    public StructuralKey(): string
    {
        return `var:${JSON.stringify(this.Variable)}`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? this;
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
    private static readonly NoReadYourWrites = "cannot read a property of a node created in the same query before RETURN; intra-query read-your-writes is not supported";

    constructor(public readonly Variable: string, public readonly Property: string)
    {
        super();
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        const target = ctx.Binding.Get(this.Variable);
        if (target instanceof MapValue) return target.Get(this.Property) ?? NullValue.Instance;
        if (target instanceof NodeRefValue) throw new CypherSemanticError(PropertyAccess.NoReadYourWrites);
        if (!(target instanceof NodeValue)) return NullValue.Instance;
        const value = target.Field(this.Property);
        return value === undefined ? NullValue.Instance : new ScalarValue(value);
    }

    public StructuralKey(): string
    {
        return `prop:${JSON.stringify(this.Variable)}.${JSON.stringify(this.Property)}`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? this;
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

    public get Value(): Scalar | null
    {
        return this.value;
    }

    public Evaluate(): CypherValue
    {
        return this.value === null ? NullValue.Instance : new ScalarValue(this.value);
    }

    public StructuralKey(): string
    {
        // JSON.stringify renders NaN/+-Infinity as null, which would collide with the null literal.
        if (typeof this.value === "number" && !Number.isFinite(this.value)) return `lit:num:${String(this.value)}`;
        return `lit:${JSON.stringify(this.value)}`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? this;
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

    public StructuralKey(): string
    {
        return `val:${this.value.GroupKey()}`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? this;
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
        return value;
    }

    public StructuralKey(): string
    {
        return `param:${JSON.stringify(this.Name)}`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? this;
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

    public get Left(): Expression
    {
        return this.left;
    }

    public get Op(): ComparisonOp
    {
        return this.op;
    }

    public get Right(): Expression
    {
        return this.right;
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

    public StructuralKey(): string
    {
        return `cmp:${this.op}(${this.left.StructuralKey()},${this.right.StructuralKey()})`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? new Comparison(this.left.Rewrite(replacer), this.op, this.right.Rewrite(replacer));
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

    public get Op(): BooleanOp
    {
        return this.op;
    }

    public get Operands(): readonly Expression[]
    {
        return this.operands;
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

    public StructuralKey(): string
    {
        return `bool:${this.op}(${this.operands.map((o) => o.StructuralKey()).join(",")})`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? new BooleanExpression(this.op, this.operands.map((o) => o.Rewrite(replacer)));
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

    public get Operand(): Expression
    {
        return this.operand;
    }

    public get Negated(): boolean
    {
        return this.negated;
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        const isNull = this.operand.Evaluate(ctx) instanceof NullValue;
        return new ScalarValue(this.negated ? !isNull : isNull);
    }

    public StructuralKey(): string
    {
        return `isnull:${this.negated}(${this.operand.StructuralKey()})`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? new IsNullExpression(this.operand.Rewrite(replacer), this.negated);
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

    public get Operand(): Expression
    {
        return this.operand;
    }

    public get List(): readonly Expression[]
    {
        return this.list;
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

    public StructuralKey(): string
    {
        return `in:(${this.operand.StructuralKey()},[${this.list.map((e) => e.StructuralKey()).join(",")}])`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? new InExpression(this.operand.Rewrite(replacer), this.list.map((e) => e.Rewrite(replacer)));
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

    public get Left(): Expression
    {
        return this.left;
    }

    public get Op(): ArithmeticOp
    {
        return this.op;
    }

    public get Right(): Expression
    {
        return this.right;
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

    public StructuralKey(): string
    {
        return `arith:${this.op}(${this.left.StructuralKey()},${this.right.StructuralKey()})`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? new ArithmeticExpression(this.left.Rewrite(replacer), this.op, this.right.Rewrite(replacer));
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

    public get Operand(): Expression
    {
        return this.operand;
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        const v = this.operand.Evaluate(ctx);
        if (v instanceof ScalarValue && typeof v.Value === "number") return new ScalarValue(-v.Value);
        return NullValue.Instance;
    }

    public StructuralKey(): string
    {
        return `neg:(${this.operand.StructuralKey()})`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? new UnaryMinus(this.operand.Rewrite(replacer));
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

    public get Items(): readonly Expression[]
    {
        return this.items;
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        return new ListValue(this.items.map((i) => i.Evaluate(ctx)));
    }

    public StructuralKey(): string
    {
        return `list:[${this.items.map((i) => i.StructuralKey()).join(",")}]`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? new ListLiteral(this.items.map((i) => i.Rewrite(replacer)));
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

    public get Entries(): ReadonlyMap<string, Expression>
    {
        return this.entries;
    }

    public Evaluate(ctx: EvalContext): CypherValue
    {
        const out = new Map<string, CypherValue>();
        for (const [k, e] of this.entries) out.set(k, e.Evaluate(ctx));
        return new MapValue(out);
    }

    public StructuralKey(): string
    {
        return `map:{${[...this.entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${v.StructuralKey()}`).join(",")}}`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? new MapLiteral(new Map([...this.entries].map(([k, e]) => [k, e.Rewrite(replacer)] as [string, Expression])));
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

    public get Target(): Expression
    {
        return this.target;
    }

    public get Index(): Expression
    {
        return this.index;
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

    public StructuralKey(): string
    {
        return `index:(${this.target.StructuralKey()},${this.index.StructuralKey()})`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? new IndexAccess(this.target.Rewrite(replacer), this.index.Rewrite(replacer));
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

    public StructuralKey(): string
    {
        return `fn:${JSON.stringify(this.Name.toLowerCase())}:${this.Distinct}:${this.Star}:[${this.Args.map((a) => a.StructuralKey()).join(",")}]`;
    }

    public Rewrite(replacer: (e: Expression) => Expression | undefined): Expression
    {
        return replacer(this) ?? new FunctionCall(this.Name, this.Args.map((a) => a.Rewrite(replacer)), this.Distinct, this.Star);
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
