import { type IPropertyBag } from '@pragmatic-tech-ai/todl-runtime';
import { type Solution } from '../solution-manager/engine/solution.js';
import { BagScope } from './bag-address.js';
import { type IBagPersister } from './bag-persister.js';
import { RecordPropertyBag } from './record-property-bag.js';

// Persists property bags at the SOLUTION scope, backed by the active Solution's live bags
// (serialized into solution.json's `bags` section on save). Writes are in-memory + mark the
// solution dirty; the actual disk write happens via SolutionManagerService.Save, so Flush is
// a no-op here.
export class SolutionBagPersister implements IBagPersister
{
    public readonly Scope = BagScope.Solution;

    constructor(private readonly solution: Solution)
    {
    }

    public Ids(kind: string): readonly string[]
    {
        return [...this.solution.InstancesOf(kind).keys()];
    }

    public Bag(kind: string, id: string): IPropertyBag
    {
        const values = this.solution.InstancesOf(kind).get(id) ?? new Map<string, unknown>();
        return new RecordPropertyBag(values, () => this.solution.MarkBagsDirty());
    }

    public Create(kind: string, id: string): IPropertyBag
    {
        const instances = this.solution.InstancesOf(kind);
        let values = instances.get(id);
        if (values === undefined)
        {
            values = new Map<string, unknown>();
            instances.set(id, values);
            this.solution.MarkBagsDirty();
        }
        return new RecordPropertyBag(values, () => this.solution.MarkBagsDirty());
    }

    public Delete(kind: string, id: string): void
    {
        if (this.solution.InstancesOf(kind).delete(id)) this.solution.MarkBagsDirty();
    }

    // The solution persists through SolutionManagerService.Save; nothing to flush here.
    public Flush(): Promise<void>
    {
        return Promise.resolve();
    }
}
