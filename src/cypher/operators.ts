import type { Scalar } from "../manifest/logical.js";
import type { ICypherGraph } from "./graph.js";
import type { Expression } from "./expressions.js";
import type { ReturnItem } from "./query-model.js";
import { Binding, EvalContext } from "./binding.js";
import { NodeValue } from "./values.js";
import { BooleanExpression } from "./expressions.js";
import { RelDirection } from "./enums.js";

export interface IOperator
{
    Rows(): Iterable<Binding>;
}

export class AllNodesScan implements IOperator
{
    constructor(private readonly graph: ICypherGraph, private readonly variable: string)
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const m of this.graph.AllInstances())
        {
            yield new Binding().With(this.variable, new NodeValue(m));
        }
    }
}

export class LabelScan implements IOperator
{
    constructor(private readonly graph: ICypherGraph, private readonly variable: string, private readonly label: string)
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const m of this.graph.NodesByLabel(this.label))
        {
            yield new Binding().With(this.variable, new NodeValue(m));
        }
    }
}

export class Expand implements IOperator
{
    constructor(
        private readonly child: IOperator,
        private readonly graph: ICypherGraph,
        private readonly fromVar: string,
        private readonly toVar: string,
        private readonly relType: string | undefined,
        private readonly direction: RelDirection,
        private readonly toLabel: string | undefined,
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            const from = row.Get(this.fromVar);
            if (!(from instanceof NodeValue)) continue;
            for (const target of this.graph.Expand(from.Id, this.relType, this.direction))
            {
                if (this.toLabel !== undefined && !this.graph.IsInstanceOf(target, this.toLabel)) continue;
                yield row.With(this.toVar, new NodeValue(target));
            }
        }
    }
}

export class Filter implements IOperator
{
    constructor(private readonly child: IOperator, private readonly predicate: Expression, private readonly parameters: ReadonlyMap<string, Scalar>)
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            const ctx = new EvalContext(row, this.parameters);
            if (BooleanExpression.Truthy(this.predicate.Evaluate(ctx))) yield row;
        }
    }
}

export class Project implements IOperator
{
    constructor(private readonly child: IOperator, private readonly items: readonly ReturnItem[], private readonly parameters: ReadonlyMap<string, Scalar>)
    {
    }

    public *Rows(): Iterable<Binding>
    {
        for (const row of this.child.Rows())
        {
            const ctx = new EvalContext(row, this.parameters);
            let projected = new Binding();
            for (const item of this.items)
            {
                projected = projected.With(item.ColumnName(), item.Expr.Evaluate(ctx));
            }
            yield projected;
        }
    }
}

export class SingleRow implements IOperator
{
    public *Rows(): Iterable<Binding>
    {
        yield new Binding();
    }
}
