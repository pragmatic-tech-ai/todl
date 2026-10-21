import type { IOperator } from "./operators.js";
import type { Binding } from "./binding.js";
import { CancelProbe } from "./execution-limits.js";
import type { ICancellation } from "./execution-limits.js";

export class CartesianProduct implements IOperator
{
    constructor(
        private readonly left: IOperator,
        private readonly right: IOperator,
        private readonly cancel?: ICancellation,
    )
    {
    }

    public *Rows(): Iterable<Binding>
    {
        // Right is re-scanned per left row; buffer it since a generator is single-use.
        const probe = new CancelProbe(this.cancel);
        probe.Begin();
        const rights: Binding[] = [];
        for (const r of this.right.Rows())
        {
            probe.Tick();
            rights.push(r);
        }
        for (const l of this.left.Rows())
        {
            for (const r of rights)
            {
                probe.Tick();
                const merged = l.Merge(r);
                if (merged !== undefined)
                {
                    yield merged;
                }
            }
        }
    }
}
