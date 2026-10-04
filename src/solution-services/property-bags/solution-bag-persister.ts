import { type IPropertyBag } from '@pragmatic-tech-ai/todl-runtime';
import { type Solution } from '../solution-manager/engine/solution.js';
import { BagScope } from './bag-address.js';
import { type IBagPersister } from './bag-persister.js';
import { RecordPropertyBag } from './record-property-bag.js';

// The save seam a SolutionBagPersister flushes through: the manager that owns the active solution.
// SolutionManagerService satisfies it structurally.
export interface ISolutionSaver
{
    readonly ActiveSolution: Solution | undefined;
    Save(): Promise<void>;
}

// Persists property bags at the SOLUTION scope, backed by the active Solution's live bags
// (serialized into solution.json's `bags` section on save). Writes are in-memory + mark the
// solution dirty; the actual disk write happens via SolutionManagerService.Save. Flush is a no-op
// unless a saver is supplied, in which case it saves the active solution when it has an on-disk
// location (an untitled solution is skipped).
export class SolutionBagPersister implements IBagPersister
{
    public readonly Scope = BagScope.Solution;

    constructor(private readonly solution: Solution, private readonly saver?: ISolutionSaver)
    {
    }

    public Ids(kind: string): readonly string[]
    {
        return [...this.solution.InstancesOf(kind).keys()];
    }

    public Bag(kind: string, id: string): IPropertyBag
    {
        const instances = this.solution.InstancesOf(kind);
        const values = instances.get(id) ?? new Map<string, unknown>();
        // Create-on-write (matches GlobalBagPersister): the first write attaches the instance to the
        // live bags so it is collected on save; a read-only Bag never adds an empty instance.
        return new RecordPropertyBag(values, () => { instances.set(id, values); this.solution.MarkBagsDirty(); });
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

    public async Flush(): Promise<void>
    {
        if (this.saver?.ActiveSolution?.HasLocation === true) await this.saver.Save();
    }
}
