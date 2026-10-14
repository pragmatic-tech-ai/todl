import type { IOperator } from "./operators.js";
import type { SortItem } from "./query-model.js";
import { Binding, EvalContext } from "./binding.js";
import { CypherValue } from "./values.js";

class SortEntry
{
    constructor(public readonly Row: Binding, public readonly Keys: readonly CypherValue[])
    {
    }
}

export class Sort implements IOperator
{
    constructor(
        private readonly child: IOperator,
        private readonly keys: readonly SortItem[],
        private readonly parameters: ReadonlyMap<string, CypherValue>,
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        const buffered: SortEntry[] = [];
        for (const row of this.child.Rows())
        {
            const ctx = new EvalContext(row, this.parameters);
            buffered.push(new SortEntry(row, this.keys.map((k) => k.Expr.Evaluate(ctx))));
        }
        buffered.sort((a, b) => this.CompareEntries(a, b));
        for (const entry of buffered)
        {
            yield entry.Row;
        }
    }

    private CompareEntries(a: SortEntry, b: SortEntry): number
    {
        for (let i = 0; i < this.keys.length; i++)
        {
            const c = CypherValue.Compare(a.Keys[i]!, b.Keys[i]!);
            if (c !== 0)
            {
                return this.keys[i]!.Descending ? -c : c;
            }
        }
        return 0;
    }
}

export class Skip implements IOperator
{
    private readonly count: number;

    constructor(private readonly child: IOperator, count: number)
    {
        // Clamp to a non-negative integer; NaN skips nothing.
        this.count = Number.isNaN(count) ? 0 : Math.max(0, Math.trunc(count));
    }

    public *Rows(): Iterable<Binding>
    {
        let seen = 0;
        for (const row of this.child.Rows())
        {
            if (seen++ >= this.count)
            {
                yield row;
            }
        }
    }
}

export class Limit implements IOperator
{
    constructor(private readonly child: IOperator, private readonly count: number)
    {
    }

    public *Rows(): Iterable<Binding>
    {
        if (this.count <= 0)
        {
            return;
        }
        let emitted = 0;
        for (const row of this.child.Rows())
        {
            yield row;
            if (++emitted >= this.count)
            {
                return;
            }
        }
    }
}

export class Distinct implements IOperator
{
    private static readonly MissingKey = "undefined";

    constructor(private readonly child: IOperator, private readonly columns: readonly string[])
    {
    }

    public *Rows(): Iterable<Binding>
    {
        const seen = new Set<string>();
        for (const row of this.child.Rows())
        {
            // JSON-encode the per-column keys so a key containing any separator cannot merge distinct rows.
            const key = JSON.stringify(this.columns.map((c) => row.Get(c)?.GroupKey() ?? Distinct.MissingKey));
            if (!seen.has(key))
            {
                seen.add(key);
                yield row;
            }
        }
    }
}
