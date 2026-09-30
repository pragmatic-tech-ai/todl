import { BagAddress } from './bag-address.js';
import { type IBagCatalog, type BagVantage, type ResolvedBag } from './bag-catalog.js';
import { ConnectionBag, ConnectionBagKind } from './connection-bag.js';

// The bag KIND that records which connection is selected, per purpose. One project-local instance
// (id = SelectionId); each field is a ConnectionPurpose value → the selected connection's
// BagAddress.Key. Project-local because a selection is user/machine-specific, not shared.
export const ConnectionSelectionKind = 'connection-selection';

// What a connection is being resolved FOR. A hierarchy can point different purposes at different
// connections (resolve references against one registry, publish to another).
export enum ConnectionPurpose
{
    ReferenceResolution = 'reference-resolution',
    Publish = 'publish',
}

// Resolves the effective connection for a purpose from a vantage: an explicit project-local
// selection if it still points at a visible connection, else the nearest scope whose npm-connection
// is marked IsDefault (project → solution → global). Owns no ambient state — the consumer supplies
// the catalog and the vantage.
export class ConnectionResolution
{
    private static readonly SelectionId = 'main';

    constructor(private readonly catalog: IBagCatalog)
    {
    }

    public EffectiveFor(purpose: ConnectionPurpose, vantage: BagVantage): ResolvedBag | undefined
    {
        const selectedKey = this.selectedAddressKey(purpose, vantage);
        if (selectedKey !== undefined)
        {
            const hit = this.connections(vantage).find((c) => BagAddress.Key(c.Address) === selectedKey);
            if (hit !== undefined) return hit;   // dangling selection falls through to the default
        }
        return this.nearestDefault(vantage);
    }

    // Record an explicit selection for a purpose, project-local. No-op when no project is open
    // (there is nowhere project-local to store it).
    public Select(purpose: ConnectionPurpose, address: BagAddress, vantage: BagVantage): void
    {
        if (vantage.ProjectLocal === undefined) return;
        const bag = vantage.ProjectLocal.Create(ConnectionSelectionKind, ConnectionResolution.SelectionId);
        bag.SetValue(purpose, BagAddress.Key(address));
    }

    // Clear a purpose's selection so resolution falls back to the nearest default.
    public Clear(purpose: ConnectionPurpose, vantage: BagVantage): void
    {
        if (vantage.ProjectLocal === undefined) return;
        if (!vantage.ProjectLocal.Ids(ConnectionSelectionKind).includes(ConnectionResolution.SelectionId)) return;
        vantage.ProjectLocal.Bag(ConnectionSelectionKind, ConnectionResolution.SelectionId).SetValue(purpose, '');
    }

    private connections(vantage: BagVantage): readonly ResolvedBag[]
    {
        return this.catalog.Visible(ConnectionBagKind, vantage);
    }

    private nearestDefault(vantage: BagVantage): ResolvedBag | undefined
    {
        return this.connections(vantage).find((c) => new ConnectionBag(c.Values).IsDefault);
    }

    private selectedAddressKey(purpose: ConnectionPurpose, vantage: BagVantage): string | undefined
    {
        const selection = this.catalog.Nearest(ConnectionSelectionKind, vantage);
        if (selection === undefined) return undefined;
        const key = selection.Values.GetValue(purpose);
        return typeof key === 'string' && key.length > 0 ? key : undefined;
    }
}
