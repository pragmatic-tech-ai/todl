import type { IOperator } from "./operators.js";
import type { Binding } from "./binding.js";

export class CartesianProduct implements IOperator
{
    constructor(
        private readonly left: IOperator,
        private readonly right: IOperator,
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        // Right is re-scanned per left row; buffer it since a generator is single-use.
        const rights = [...this.right.Rows()];
        for (const l of this.left.Rows())
        {
            for (const r of rights)
            {
                const merged = l.Merge(r);
                if (merged !== undefined)
                {
                    yield merged;
                }
            }
        }
    }
}
