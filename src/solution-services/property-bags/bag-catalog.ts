import { type IPropertyBag } from '@pragmatic-tech-ai/todl-runtime';
import { BagAddress, ProjectStore } from './bag-address.js';
import { type IBagPersister } from './bag-persister.js';

// The set of persisters visible from one point in the hierarchy. Global is always present; the
// others appear only when a solution/project is open. The consumer builds this and hands it to the
// catalog — the catalog never reaches for ambient state.
export interface BagVantage
{
    Global: IBagPersister;
    Solution?: IBagPersister;
    ProjectShared?: IBagPersister;
    ProjectLocal?: IBagPersister;
}

// One addressed bag the catalog surfaced. Values is the live bag from its persister — writing
// through it writes to that persister's scope only.
export interface ResolvedBag
{
    Address: BagAddress;
    Values: IPropertyBag;
}

// Read-only view over the bags of a kind visible from a vantage. No cascade/merge: every instance
// is surfaced distinctly, nearest-first, and the consumer decides which to use.
export interface IBagCatalog
{
    Visible(kind: string, vantage: BagVantage): readonly ResolvedBag[];
    Get(address: BagAddress, vantage: BagVantage): ResolvedBag | undefined;
    Nearest(kind: string, vantage: BagVantage): ResolvedBag | undefined;
}

export class BagCatalog implements IBagCatalog
{
    public Visible(kind: string, vantage: BagVantage): readonly ResolvedBag[]
    {
        const out: ResolvedBag[] = [];
        for (const [persister, projectStore] of BagCatalog.ordered(vantage))
        {
            for (const id of persister.Ids(kind))
            {
                out.push({ Address: new BagAddress(persister.Scope, kind, id, projectStore), Values: persister.Bag(kind, id) });
            }
        }
        return out;
    }

    public Get(address: BagAddress, vantage: BagVantage): ResolvedBag | undefined
    {
        const key = BagAddress.Key(address);
        return this.Visible(address.Kind, vantage).find((r) => BagAddress.Key(r.Address) === key);
    }

    public Nearest(kind: string, vantage: BagVantage): ResolvedBag | undefined
    {
        return this.Visible(kind, vantage)[0];
    }

    // Nearest-first: ProjectLocal → ProjectShared → Solution → Global. Each project persister carries
    // the ProjectStore tag its address needs; Solution/Global have none.
    private static ordered(vantage: BagVantage): readonly [IBagPersister, ProjectStore | undefined][]
    {
        const list: [IBagPersister, ProjectStore | undefined][] = [];
        if (vantage.ProjectLocal !== undefined) list.push([vantage.ProjectLocal, ProjectStore.Local]);
        if (vantage.ProjectShared !== undefined) list.push([vantage.ProjectShared, ProjectStore.Shared]);
        if (vantage.Solution !== undefined) list.push([vantage.Solution, undefined]);
        list.push([vantage.Global, undefined]);
        return list;
    }
}
