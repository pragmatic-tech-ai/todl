import test from 'node:test'
import assert from 'node:assert/strict'
import { type IPropertyBag } from '@pragmatic-tech-ai/todl-runtime'
import { BagCatalog, type BagVantage } from '../bag-catalog.js'
import { BagAddress, BagScope } from '../bag-address.js'
import { type IBagPersister } from '../bag-persister.js'
import { RecordPropertyBag } from '../record-property-bag.js'
import { ConnectionBag, ConnectionBagKind } from '../connection-bag.js'
import { ConnectionResolution, ConnectionPurpose } from '../connection-resolution.js'

class FakeBagPersister implements IBagPersister
{
    private readonly live = new Map<string, Map<string, Map<string, unknown>>>()
    constructor(public readonly Scope: BagScope) {}
    Ids(kind: string): readonly string[] { return [...(this.live.get(kind)?.keys() ?? [])] }
    Bag(kind: string, id: string): IPropertyBag { return new RecordPropertyBag(this.ensure(kind, id)) }
    Create(kind: string, id: string): IPropertyBag { return new RecordPropertyBag(this.ensure(kind, id)) }
    Delete(kind: string, id: string): void { this.live.get(kind)?.delete(id) }
    Flush(): Promise<void> { return Promise.resolve() }
    private ensure(kind: string, id: string): Map<string, unknown>
    {
        let byId = this.live.get(kind); if (byId === undefined) { byId = new Map(); this.live.set(kind, byId) }
        let v = byId.get(id); if (v === undefined) { v = new Map(); byId.set(id, v) }
        return v
    }
}

function seed(scope: BagScope, persister: IBagPersister, id: string, isDefault: boolean): void
{
    const c = new ConnectionBag(persister.Create(ConnectionBagKind, id))
    c.DisplayName = `${scope}:${id}`
    c.RegistryType = 'npm'
    c.IsDefault = isDefault
}

function vantageOf(global: IBagPersister, solution: IBagPersister, projLocal: IBagPersister): BagVantage
{
    return { Global: global, Solution: solution, ProjectLocal: projLocal }
}

test('an explicit selection wins: EffectiveFor returns the pointed-at connection', () =>
{
    const global = new FakeBagPersister(BagScope.Global)
    const solution = new FakeBagPersister(BagScope.Solution)
    const projLocal = new FakeBagPersister(BagScope.Project)
    seed(BagScope.Global, global, 'gh', true)
    seed(BagScope.Solution, solution, 'gh', false)
    const vantage = vantageOf(global, solution, projLocal)
    const res = new ConnectionResolution(new BagCatalog())

    res.Select(ConnectionPurpose.ReferenceResolution, new BagAddress(BagScope.Solution, ConnectionBagKind, 'gh'), vantage)
    const eff = res.EffectiveFor(ConnectionPurpose.ReferenceResolution, vantage)
    assert.equal(eff?.Address.Scope, BagScope.Solution)
})

test('no selection: nearest IsDefault wins — project over solution over global', () =>
{
    const global = new FakeBagPersister(BagScope.Global)
    const solution = new FakeBagPersister(BagScope.Solution)
    const projLocal = new FakeBagPersister(BagScope.Project)
    seed(BagScope.Global, global, 'gh', true)
    seed(BagScope.Solution, solution, 'gh', true)
    seed(BagScope.Project, projLocal, 'gh', true)
    const vantage = vantageOf(global, solution, projLocal)
    const res = new ConnectionResolution(new BagCatalog())

    assert.equal(res.EffectiveFor(ConnectionPurpose.ReferenceResolution, vantage)?.Address.Scope, BagScope.Project)

    // Solution over global when the project has no default.
    const v2 = vantageOf(global, solution, new FakeBagPersister(BagScope.Project))
    assert.equal(res.EffectiveFor(ConnectionPurpose.ReferenceResolution, v2)?.Address.Scope, BagScope.Solution)
})

test('a dangling selection falls back to the nearest default without throwing', () =>
{
    const global = new FakeBagPersister(BagScope.Global)
    const solution = new FakeBagPersister(BagScope.Solution)
    const projLocal = new FakeBagPersister(BagScope.Project)
    seed(BagScope.Global, global, 'gh', true)
    const vantage = vantageOf(global, solution, projLocal)
    const res = new ConnectionResolution(new BagCatalog())

    res.Select(ConnectionPurpose.Publish, new BagAddress(BagScope.Solution, ConnectionBagKind, 'ghost'), vantage)
    const eff = res.EffectiveFor(ConnectionPurpose.Publish, vantage)
    assert.equal(eff?.Address.Scope, BagScope.Global)   // fell back to nearest default
})

test('no selection and no default yields undefined', () =>
{
    const global = new FakeBagPersister(BagScope.Global)
    const solution = new FakeBagPersister(BagScope.Solution)
    const projLocal = new FakeBagPersister(BagScope.Project)
    seed(BagScope.Global, global, 'gh', false)
    const vantage = vantageOf(global, solution, projLocal)
    const res = new ConnectionResolution(new BagCatalog())
    assert.equal(res.EffectiveFor(ConnectionPurpose.ReferenceResolution, vantage), undefined)
})
