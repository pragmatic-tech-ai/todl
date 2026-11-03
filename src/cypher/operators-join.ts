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
        // Right is re-scanned per left row; buffer it since a generator is single-use. It is buffered at the FIRST left
        // row, not up front: a write clause under the left side (fenced by an EagerBarrier) has then completed before the
        // right side reads the graph, and an empty left side never scans the right at all.
        const probe = new CancelProbe(this.cancel);
        probe.Begin();
        let rights: Binding[] | undefined;
        for (const l of this.left.Rows())
        {
            rights ??= this.BufferRight(probe);
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

    private BufferRight(probe: CancelProbe): Binding[]
    {
        const rights: Binding[] = [];
        for (const r of this.right.Rows())
        {
            probe.Tick();
            rights.push(r);
        }
        return rights;
    }
}
