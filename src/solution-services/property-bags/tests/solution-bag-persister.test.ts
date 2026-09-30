import test from 'node:test'
import assert from 'node:assert/strict'
import { Solution } from '../../solution-manager/engine/solution.js'
import { SolutionManifest } from '../../solution-manager/engine/solution-manifest.js'
import { SolutionBagPersister } from '../solution-bag-persister.js'
import { BagScope } from '../bag-address.js'

test('SolutionBagPersister creates, reads, round-trips (CollectBags→LoadBags), and deletes bag instances', () =>
{
    const solution = new Solution('S')
    const p = new SolutionBagPersister(solution)
    assert.equal(p.Scope, BagScope.Solution)
    const bag = p.Create('npm-connection', 'gh')
    bag.SetValue('DisplayName', 'GitHub')
    bag.SetValue('RegistryType', 'npm')
    assert.deepEqual(p.Ids('npm-connection'), ['gh'])
    assert.equal(p.Bag('npm-connection', 'gh').GetValue('DisplayName'), 'GitHub')
    assert.deepEqual(p.Ids('unknown-kind'), [])                 // missing kind → empty, no throw

    const reloaded = new Solution('S')
    reloaded.LoadBags(solution.CollectBags())
    const p2 = new SolutionBagPersister(reloaded)
    assert.equal(p2.Bag('npm-connection', 'gh').GetValue('DisplayName'), 'GitHub')
    p2.Delete('npm-connection', 'gh')
    assert.deepEqual(p2.Ids('npm-connection'), [])
})

test('SolutionManifest carries a bags section through stringify/parse (defensive when absent)', () =>
{
    const m = new SolutionManifest('S', [], {}, { 'npm-connection': { gh: { DisplayName: 'GitHub' } } })
    const back = SolutionManifest.parse(m.stringify())
    assert.equal(back.bags['npm-connection']!.gh!.DisplayName, 'GitHub')
    // A legacy manifest with no bags section parses to an empty bags map.
    const legacy = SolutionManifest.parse(JSON.stringify({ kind: 'todl-solution', version: 1, name: 'S', members: [], settings: {} }))
    assert.deepEqual(legacy.bags, {})
})
