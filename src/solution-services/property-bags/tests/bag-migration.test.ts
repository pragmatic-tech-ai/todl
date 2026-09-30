import test from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage, type IPropertyBag } from '@pragmatic-tech-ai/todl-runtime'
import { BagMigration } from '../bag-migration.js'
import { BagAddress, BagScope } from '../bag-address.js'
import { type IBagPersister } from '../bag-persister.js'
import { RecordPropertyBag } from '../record-property-bag.js'
import { ConnectionBag, ConnectionBagKind, TokenSource } from '../connection-bag.js'
import { ConnectionSelectionKind, ConnectionPurpose } from '../connection-resolution.js'

class FakeBagPersister implements IBagPersister
{
    public flushes = 0
    private readonly live = new Map<string, Map<string, Map<string, unknown>>>()
    constructor(public readonly Scope: BagScope) {}
    Ids(kind: string): readonly string[] { return [...(this.live.get(kind)?.keys() ?? [])] }
    Bag(kind: string, id: string): IPropertyBag { return new RecordPropertyBag(this.ensure(kind, id)) }
    Create(kind: string, id: string): IPropertyBag { return new RecordPropertyBag(this.ensure(kind, id)) }
    Delete(kind: string, id: string): void { this.live.get(kind)?.delete(id) }
    Flush(): Promise<void> { this.flushes++; return Promise.resolve() }
    private ensure(kind: string, id: string): Map<string, unknown>
    {
        let byId = this.live.get(kind); if (byId === undefined) { byId = new Map(); this.live.set(kind, byId) }
        let v = byId.get(id); if (v === undefined) { v = new Map(); byId.set(id, v) }
        return v
    }
}

const CONNECTIONS_JSON = JSON.stringify({
    version: 2,
    defaultId: 'gh',
    connections: [
        { Id: 'gh', DisplayName: 'GitHub', RegistryType: 'npm', Settings: { registry: 'https://npm.pkg.github.com' }, TokenSource: 'stored' },
        { Id: 'env1', DisplayName: 'Env npm', RegistryType: 'npm', Settings: {}, TokenSource: 'env', TokenEnvVar: 'NPM_TOKEN' },
    ],
})

test('MigrateGlobal maps connections.json → global npm-connection bags (secret-reference only) + IsDefault', async () =>
{
    const storage = new FakeStorage('/u')
    await storage.WriteText('connections.json', CONNECTIONS_JSON)
    const global = new FakeBagPersister(BagScope.Global)

    await new BagMigration().MigrateGlobal(storage, global)

    assert.deepEqual([...global.Ids(ConnectionBagKind)].sort(), ['env1', 'gh'])
    const gh = new ConnectionBag(global.Bag(ConnectionBagKind, 'gh'))
    assert.equal(gh.DisplayName, 'GitHub')
    assert.equal(gh.RegistryType, 'npm')
    assert.equal(gh.Settings.registry, 'https://npm.pkg.github.com')
    assert.equal(gh.TokenSource, TokenSource.Stored)
    assert.equal(gh.TokenRef, 'gh')                 // Stored ⇒ secret keyed by connection id
    assert.equal(gh.IsDefault, true)
    const env = new ConnectionBag(global.Bag(ConnectionBagKind, 'env1'))
    assert.equal(env.TokenSource, TokenSource.Env)
    assert.equal(env.TokenEnvVar, 'NPM_TOKEN')
    assert.equal(env.TokenRef, '')                  // Env ⇒ no stored-secret reference
    assert.equal(env.IsDefault, false)
})

test('MigrateGlobal is idempotent: a second run holds the marker, keeping a hand-added connection and not duplicating', async () =>
{
    const storage = new FakeStorage('/u')
    await storage.WriteText('connections.json', CONNECTIONS_JSON)
    const global = new FakeBagPersister(BagScope.Global)
    const mig = new BagMigration()

    await mig.MigrateGlobal(storage, global)
    new ConnectionBag(global.Create(ConnectionBagKind, 'hand')).DisplayName = 'Hand added'   // user adds one after migration

    await mig.MigrateGlobal(storage, global)                                                  // second run

    assert.deepEqual([...global.Ids(ConnectionBagKind)].sort(), ['env1', 'gh', 'hand'])       // no dup, hand kept
    assert.equal(new ConnectionBag(global.Bag(ConnectionBagKind, 'hand')).DisplayName, 'Hand added')
})

test('MigrateGlobal with no connections.json does nothing (no bags, no marker)', async () =>
{
    const storage = new FakeStorage('/u')
    const global = new FakeBagPersister(BagScope.Global)
    await new BagMigration().MigrateGlobal(storage, global)
    assert.deepEqual(global.Ids(ConnectionBagKind), [])
    assert.deepEqual(global.Ids(BagMigration.MarkerKind), [])
})

test('MigrateSolution maps member overrides → each member project-local connection-selection[reference-resolution]', async () =>
{
    const overrides = new Map<string, string>([['projA', 'gh'], ['projB', 'env1']])
    const solutionMarker = new FakeBagPersister(BagScope.Solution)
    const locals = new Map<string, FakeBagPersister>([['projA', new FakeBagPersister(BagScope.Project)], ['projB', new FakeBagPersister(BagScope.Project)]])
    const mig = new BagMigration()

    await mig.MigrateSolution(overrides, solutionMarker, (path) => locals.get(path))

    const selA = locals.get('projA')!.Bag(ConnectionSelectionKind, BagMigration.SelectionId)
    assert.equal(selA.GetValue(ConnectionPurpose.ReferenceResolution), BagAddress.Key(new BagAddress(BagScope.Global, ConnectionBagKind, 'gh')))
    const selB = locals.get('projB')!.Bag(ConnectionSelectionKind, BagMigration.SelectionId)
    assert.equal(selB.GetValue(ConnectionPurpose.ReferenceResolution), BagAddress.Key(new BagAddress(BagScope.Global, ConnectionBagKind, 'env1')))

    // Idempotent: a second run holds the solution marker and does not re-touch project-local stores.
    const flushesA = locals.get('projA')!.flushes
    await mig.MigrateSolution(overrides, solutionMarker, (path) => locals.get(path))
    assert.equal(locals.get('projA')!.flushes, flushesA)
})
