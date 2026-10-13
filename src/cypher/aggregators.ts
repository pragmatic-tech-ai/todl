import { CypherValue, ScalarValue, NullValue } from "./values.js";
import { ListValue } from "./values-structured.js";
import { CypherSemanticError } from "./errors.js";

export interface IAggregator
{
    Accept(value: CypherValue): void;
    Result(): CypherValue;
}

export class CountAggregator implements IAggregator
{
    private count = 0;

    constructor(private readonly countStar: boolean)
    {
    }

    public Accept(value: CypherValue): void
    {
        if (this.countStar || !(value instanceof NullValue))
        {
            this.count++;
        }
    }

    public Result(): CypherValue
    {
        return new ScalarValue(this.count);
    }
}

export class CollectAggregator implements IAggregator
{
    private readonly items: CypherValue[] = [];

    public Accept(value: CypherValue): void
    {
        if (!(value instanceof NullValue))
        {
            this.items.push(value);
        }
    }

    public Result(): CypherValue
    {
        return new ListValue([...this.items]);
    }
}

export class SumAggregator implements IAggregator
{
    protected total = 0;
    protected n = 0;

    public Accept(value: CypherValue): void
    {
        if (value instanceof ScalarValue && typeof value.Value === "number")
        {
            this.total += value.Value;
            this.n++;
        }
    }

    public Result(): CypherValue
    {
        return new ScalarValue(this.total);
    }
}

export class AvgAggregator extends SumAggregator
{
    public override Result(): CypherValue
    {
        return this.n === 0 ? NullValue.Instance : new ScalarValue(this.total / this.n);
    }
}

abstract class ExtremeAggregator implements IAggregator
{
    private best: CypherValue | null = null;

    protected abstract Prefers(cmp: number): boolean;

    public Accept(value: CypherValue): void
    {
        if (value instanceof NullValue)
        {
            return;
        }
        if (this.best === null || this.Prefers(CypherValue.Compare(value, this.best)))
        {
            this.best = value;
        }
    }

    public Result(): CypherValue
    {
        return this.best ?? NullValue.Instance;
    }
}

export class MinAggregator extends ExtremeAggregator
{
    protected Prefers(cmp: number): boolean
    {
        return cmp < 0;
    }
}

export class MaxAggregator extends ExtremeAggregator
{
    protected Prefers(cmp: number): boolean
    {
        return cmp > 0;
    }
}

export class AggregatorFactory
{
    private static readonly UnknownMessage = "Unknown aggregate function: ";

    public static Create(name: string, countStar: boolean): IAggregator
    {
        switch (name.toLowerCase())
        {
            case "count": return new CountAggregator(countStar);
            case "collect": return new CollectAggregator();
            case "sum": return new SumAggregator();
            case "avg": return new AvgAggregator();
            case "min": return new MinAggregator();
            case "max": return new MaxAggregator();
        }
        throw new CypherSemanticError(AggregatorFactory.UnknownMessage + name);
    }
}
