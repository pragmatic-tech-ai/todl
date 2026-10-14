import type { Scalar } from "../manifest/logical.js";
import type { IOperator } from "./operators.js";
import type { ReturnItem } from "./query-model.js";
import type { FunctionCall } from "./expressions.js";
import { Binding, EvalContext } from "./binding.js";
import { CypherValue, NullValue } from "./values.js";
import { AggregatorFactory } from "./aggregators.js";
import type { IAggregator } from "./aggregators.js";

export interface AggregateItem
{
    readonly Column: string;
    readonly Call: FunctionCall;
}

class GroupState
{
    public readonly Aggregators: IAggregator[];
    public readonly Seen: Set<string>[];

    constructor(public readonly GroupValues: readonly CypherValue[], items: readonly AggregateItem[])
    {
        this.Aggregators = items.map((i) => AggregatorFactory.Create(i.Call.Name, i.Call.Star));
        this.Seen = items.map(() => new Set<string>());
    }
}

export class Aggregate implements IOperator
{
    private static readonly EmptyGroupKey = "";

    constructor(
        private readonly child: IOperator,
        private readonly groupingItems: readonly ReturnItem[],
        private readonly aggregateItems: readonly AggregateItem[],
        private readonly parameters: ReadonlyMap<string, Scalar>,
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        const groups = new Map<string, GroupState>();
        for (const row of this.child.Rows())
        {
            const ctx = new EvalContext(row, this.parameters);
            const values = this.groupingItems.map((i) => i.Expr.Evaluate(ctx));
            const key = JSON.stringify(values.map((v) => v.GroupKey()));
            let state = groups.get(key);
            if (state === undefined)
            {
                state = new GroupState(values, this.aggregateItems);
                groups.set(key, state);
            }
            this.Accumulate(state, ctx);
        }
        if (groups.size === 0 && this.groupingItems.length === 0)
        {
            groups.set(Aggregate.EmptyGroupKey, new GroupState([], this.aggregateItems));
        }
        for (const state of groups.values())
        {
            yield this.Emit(state);
        }
    }

    private Accumulate(state: GroupState, ctx: EvalContext): void
    {
        for (let i = 0; i < this.aggregateItems.length; i++)
        {
            const call = this.aggregateItems[i]!.Call;
            const value = call.Star || call.Args.length === 0 ? NullValue.Instance : call.Args[0]!.Evaluate(ctx);
            if (call.Distinct && !call.Star)
            {
                const gk = value.GroupKey();
                if (state.Seen[i]!.has(gk))
                {
                    continue;
                }
                state.Seen[i]!.add(gk);
            }
            state.Aggregators[i]!.Accept(value);
        }
    }

    private Emit(state: GroupState): Binding
    {
        let out = new Binding();
        for (let i = 0; i < this.groupingItems.length; i++)
        {
            out = out.With(this.groupingItems[i]!.ColumnName(), state.GroupValues[i]!);
        }
        for (let i = 0; i < this.aggregateItems.length; i++)
        {
            out = out.With(this.aggregateItems[i]!.Column, state.Aggregators[i]!.Result());
        }
        return out;
    }
}
