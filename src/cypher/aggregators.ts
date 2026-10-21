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
    private static readonly CountName = "count";
    private static readonly CollectName = "collect";
    private static readonly SumName = "sum";
    private static readonly AvgName = "avg";
    private static readonly MinName = "min";
    private static readonly MaxName = "max";
    private static readonly UnknownMessage = "Unknown aggregate function: ";

    public static Create(name: string, countStar: boolean): IAggregator
    {
        switch (name.toLowerCase())
        {
            case AggregatorFactory.CountName: return new CountAggregator(countStar);
            case AggregatorFactory.CollectName: return new CollectAggregator();
            case AggregatorFactory.SumName: return new SumAggregator();
            case AggregatorFactory.AvgName: return new AvgAggregator();
            case AggregatorFactory.MinName: return new MinAggregator();
            case AggregatorFactory.MaxName: return new MaxAggregator();
        }
        throw new CypherSemanticError(AggregatorFactory.UnknownMessage + name);
    }
}
