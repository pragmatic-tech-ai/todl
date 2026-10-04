import test from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage, type IPropertyBag, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type BagVantage } from '../bag-catalog.js'
import { BagScope } from '../bag-address.js'
import { type IBagPersister } from '../bag-persister.js'
import { RecordPropertyBag } from '../record-property-bag.js'
import { ConnectionBag, ConnectionBagKind } from '../connection-bag.js'
import { ConnectionSelection } from '../connection-selection.js'
import { Solution } from '../../solution-manager/engine/solution.js'
import { type SolutionMember } from '../../solution-manager/engine/solution-member.js'

class FakeBagPersister implements IBagPersister
{
    public Flushes = 0
    private readonly live = new Map<string, Map<string, Map<string, unknown>>>()
    constructor(public readonly Scope: BagScope) {}
    Ids(kind: string): readonly string[] { return [...(this.live.get(kind)?.keys() ?? [])] }
    Bag(kind: string, id: string): IPropertyBag { return new RecordPropertyBag(this.ensure(kind, id)) }
    Create(kind: string, id: string): IPropertyBag { return new RecordPropertyBag(this.ensure(kind, id)) }
    Delete(kind: string, id: string): void { this.live.get(kind)?.delete(id) }
    Flush(): Promise<void> { this.Flushes++; return Promise.resolve() }
    private ensure(kind: string, id: string): Map<string, unknown>
    {
        let byId = this.live.get(kind); if (byId === undefined) { byId = new Map(); this.live.set(kind, byId) }
        let v = byId.get(id); if (v === undefined) { v = new Map(); byId.set(id, v) }
        return v
    }
}

class Rig
{
    public readonly Global = new FakeBagPersister(BagScope.Global)
    public readonly SolutionBags = new FakeBagPersister(BagScope.Solution)
    public readonly Local = new FakeBagPersister(BagScope.Project)
    public readonly Solution = new Solution('S')
    public readonly Member: SolutionMember
    public readonly Other: SolutionMember
    public readonly Sel: ConnectionSelection

    constructor()
    {
        this.Member = this.Solution.AddMember('./api', 'architecture')
        this.Member.Storage = new FakeStorage('/a')
        this.Other = this.Solution.AddMember('./web', 'architecture')
        this.Other.Storage = new FakeStorage('/b')
        const ids = new Map<IStorage, string>([[this.Member.Storage, 'api-id'], [this.Other.Storage, 'web-id']])
        const manager = {
            ActiveSolution: this.Solution,
            BuildVantage: (global: IBagPersister | undefined, member?: SolutionMember): Promise<BagVantage | undefined> =>
                Promise.resolve(global === undefined ? undefined : {
                    Global: global,
                    Solution: this.SolutionBags,
                    ...(member === this.Member ? { ProjectLocal: this.Local } : {}),
                }),
        }
        const resolver = { ConsumerIdOf: (s: IStorage): Promise<string | undefined> => Promise.resolve(ids.get(s)) }
        this.Sel = new ConnectionSelection(manager, resolver, this.Global)
    }

    public Seed(p: IBagPersister, id: string, isDefault: boolean): void
    {
        const c = new ConnectionBag(p.Create(ConnectionBagKind, id))
        c.RegistryType = 'npm'
        c.IsDefault = isDefault
    }
}

test('SetActiveConnectionFor writes a project-local selection that wins over the default', async () =>
{
    const r = new Rig()
    r.Seed(r.Global, 'g1', true)
    r.Seed(r.Global, 'g2', false)
    assert.equal(await r.Sel.EffectiveConnectionIdForConsumer('api-id'), 'g1')
    await r.Sel.SetActiveConnectionFor(r.Member, 'g2')
    assert.equal(await r.Sel.EffectiveConnectionIdForConsumer('api-id'), 'g2')
    assert.equal(r.Local.Flushes, 1)
})

test('ClearActiveFor removes the selection, falling back to the default', async () =>
{
    const r = new Rig()
    r.Seed(r.Global, 'g1', true)
    r.Seed(r.Global, 'g2', false)
    await r.Sel.SetActiveConnectionFor(r.Member, 'g2')
    await r.Sel.ClearActiveFor(r.Member)
    assert.equal(await r.Sel.EffectiveConnectionIdForConsumer('api-id'), 'g1')
})

test('MemberForConsumerId maps via ConsumerIdOf; unknown id is undefined', async () =>
{
    const r = new Rig()
    assert.equal(await r.Sel.MemberForConsumerId('web-id'), r.Other)
    assert.equal(await r.Sel.MemberForConsumerId('nope'), undefined)
    assert.equal(await r.Sel.EffectiveConnectionIdForConsumer('nope'), undefined)
})

test('SetSolutionDefault adopts a global-only connection at solution scope and flips existing defaults', async () =>
{
    const r = new Rig()
    r.Seed(r.SolutionBags, 'old', true)
    await r.Sel.SetSolutionDefault({ Id: 'g1', DisplayName: 'Global One', RegistryType: 'npm' })
    assert.equal(new ConnectionBag(r.SolutionBags.Bag(ConnectionBagKind, 'old')).IsDefault, false)
    const adopted = new ConnectionBag(r.SolutionBags.Bag(ConnectionBagKind, 'g1'))
    assert.equal(adopted.IsDefault, true)
    assert.equal(adopted.DisplayName, 'Global One')
    assert.equal(r.SolutionBags.Flushes, 1)
    assert.equal(await r.Sel.EffectiveConnectionIdForConsumer('api-id'), 'g1')
})
