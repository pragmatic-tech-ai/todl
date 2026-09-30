import test from 'node:test'
import assert from 'node:assert/strict'
import { type IPropertyBag } from '@pragmatic-tech-ai/todl-runtime'
import { BagCatalog, type BagVantage } from '../bag-catalog.js'
import { BagAddress, BagScope, ProjectStore } from '../bag-address.js'
import { type IBagPersister } from '../bag-persister.js'
import { RecordPropertyBag } from '../record-property-bag.js'

class FakeBagPersister implements IBagPersister
{
    private readonly live = new Map<string, Map<string, Map<string, unknown>>>()
    constructor(public readonly Scope: BagScope) {}
    Ids(kind: string): readonly string[] { return [...(this.live.get(kind)?.keys() ?? [])] }
    Bag(kind: string, id: string): IPropertyBag { return new RecordPropertyBag(this.live.get(kind)?.get(id) ?? new Map()) }
    Create(kind: string, id: string): IPropertyBag
    {
        let byId = this.live.get(kind); if (byId === undefined) { byId = new Map(); this.live.set(kind, byId) }
        let v = byId.get(id); if (v === undefined) { v = new Map(); byId.set(id, v) }
        return new RecordPropertyBag(v)
    }
    Delete(kind: string, id: string): void { this.live.get(kind)?.delete(id) }
    Flush(): Promise<void> { return Promise.resolve() }
}

test('Visible returns same-id instances at every scope, nearest-first + distinctly addressed; writes isolated; Nearest is nearest; Get by address', () =>
{
    const global = new FakeBagPersister(BagScope.Global)
    const solution = new FakeBagPersister(BagScope.Solution)
    const projLocal = new FakeBagPersister(BagScope.Project)
    global.Create('npm-connection', 'gh').SetValue('scope', 'global')
    solution.Create('npm-connection', 'gh').SetValue('scope', 'solution')
    projLocal.Create('npm-connection', 'gh').SetValue('scope', 'project')
    const vantage: BagVantage = { Global: global, Solution: solution, ProjectLocal: projLocal }
    const cat = new BagCatalog()

    const visible = cat.Visible('npm-connection', vantage)
    assert.equal(visible.length, 3)
    assert.deepEqual(visible.map((r) => r.Values.GetValue('scope')), ['project', 'solution', 'global'])   // nearest-first
    assert.equal(new Set(visible.map((r) => BagAddress.Key(r.Address))).size, 3)                          // distinctly addressed
    assert.equal(visible[0]!.Address.ProjectStore, ProjectStore.Local)

    cat.Nearest('npm-connection', vantage)!.Values.SetValue('scope', 'changed')                            // write to project...
    assert.equal(global.Bag('npm-connection', 'gh').GetValue('scope'), 'global')                           // ...does not touch global

    assert.equal(cat.Nearest('npm-connection', vantage)!.Address.Scope, BagScope.Project)
    assert.equal(cat.Get(new BagAddress(BagScope.Global, 'npm-connection', 'gh'), vantage)!.Values.GetValue('scope'), 'global')
    assert.equal(cat.Get(new BagAddress(BagScope.Solution, 'npm-connection', 'absent'), vantage), undefined)
})
