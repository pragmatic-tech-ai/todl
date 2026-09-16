import { test } from 'node:test'
import assert from 'node:assert/strict'
import { type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionManagerService } from '../solution-manager-service.js'
import {
    type IStorageProviderRegistry,
    type IProjectFactoryRegistry,
    type IDiscardConfirmer,
} from '../host-services.js'
import { FakeProjectFactory } from './fake-project-factory.js'

// Build the service the way the container does — through the constructor — with
// a fake provider that serves fake host services under the manager's three keys.
function makeService(opts?: { confirmDiscard?: () => Promise<boolean> }) {
    const roots = new Map<string, FakeStorage>()
    const storages: IStorageProviderRegistry = {
        CreateStorage: (folder) => {
            const s = roots.get(folder) ?? new FakeStorage(folder)
            roots.set(folder, s)
            return s
        },
    }
    const factories: IProjectFactoryRegistry = {
        factoryFor: (type) => (type === 'architecture' ? new FakeProjectFactory() : undefined),
    }
    const confirmer: IDiscardConfirmer = {
        confirmDiscard: opts?.confirmDiscard ?? (async () => true),
    }
    // Compose is not exercised by these tests, but the ctor now requires the key.
    const packages = { resolve: async () => { throw new Error('no compose in test') } }
    const provider = {
        get: () => undefined,
        getRequired: (token: unknown) => {
            if (token === SolutionManagerService.StorageRegistryKey) return storages
            if (token === SolutionManagerService.ProjectFactoryRegistryKey) return factories
            if (token === SolutionManagerService.DiscardConfirmerKey) return confirmer
            if (token === SolutionManagerService.PackageSourceKey) return packages
            throw new Error('unexpected service key')
        },
        has: () => true,
    } as unknown as IServiceProvider
    const svc = new SolutionManagerService(provider)
    return { svc, roots }
}

test('New → Save writes solution.json; Open reads it back with members', async () => {
    const { svc, roots } = makeService()
    await svc.NewSolution('/work/sol')
    svc.ActiveSolution!.Name = 'My Solution'
    svc.ActiveSolution!.AddMember('./api', 'architecture')
    await svc.Save()

    const stored = await roots.get('/work/sol')!.ReadText('solution.json')
    assert.match(stored, /todl-solution/)
    assert.match(stored, /\.\/api/)

    await svc.CloseSolution()
    assert.equal(svc.ActiveSolution, undefined)

    await svc.OpenSolution('/work/sol')
    assert.equal(svc.ActiveSolution!.Name, 'My Solution')
    assert.equal(svc.ActiveSolution!.Members.ToArray()[0]!.IsResolved, true)
})

test('Save clears dirty; opening adds to RecentSolutions (move-to-front, deduped)', async () => {
    const { svc } = makeService()
    await svc.NewSolution('/work/sol')
    svc.ActiveSolution!.AddMember('./a', 'architecture')
    assert.equal(svc.ActiveSolution!.IsDirty, true)
    await svc.Save()
    assert.equal(svc.ActiveSolution!.IsDirty, false)
    assert.ok(svc.RecentSolutions.includes('/work/sol'))

    // Save again should not duplicate the recent entry.
    await svc.Save()
    assert.equal(svc.RecentSolutions.filter((p) => p === '/work/sol').length, 1)
})

test('Compose runs members through the injected source and returns diagnostics', async () => {
    const { svc } = makeService()   // fake package source rejects every resolve
    const diagnostics = await svc.Compose([{ model: 'acme.widgets', version: '1.0.0' }])
    assert.equal(diagnostics.length, 1)
    assert.match(diagnostics[0]!.message, /acme\.widgets/)
})

test('a dirty solution blocks replace when the user declines', async () => {
    const { svc } = makeService({ confirmDiscard: async () => false })   // user says "don't discard"
    await svc.NewSolution('/work/a')
    svc.ActiveSolution!.AddMember('./x', 'architecture')   // now dirty
    const first = svc.ActiveSolution
    await svc.NewSolution('/work/b')   // should be blocked
    assert.equal(svc.ActiveSolution, first)
})
