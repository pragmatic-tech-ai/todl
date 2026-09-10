import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionManagerService } from '../solution-manager-service.js'
import { FakeProjectFactory } from './fake-project-factory.js'

function makeService() {
    const roots = new Map<string, FakeStorage>()
    const svc = SolutionManagerService.createForTest({
        storageForFolder: (folder) => {
            const s = roots.get(folder) ?? new FakeStorage(folder)
            roots.set(folder, s)
            return s
        },
        factoryFor: (type) => (type === 'architecture' ? new FakeProjectFactory() : undefined),
        confirmDiscard: async () => true,
    })
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
    assert.ok(svc.RecentSolutions.ToArray().includes('/work/sol'))

    // Save again should not duplicate the recent entry.
    await svc.Save()
    assert.equal(svc.RecentSolutions.ToArray().filter((p) => p === '/work/sol').length, 1)
})

test('a dirty solution blocks replace when the user declines', async () => {
    const roots = new Map<string, FakeStorage>()
    const svc = SolutionManagerService.createForTest({
        storageForFolder: (f) => { const s = roots.get(f) ?? new FakeStorage(f); roots.set(f, s); return s },
        factoryFor: () => undefined,
        confirmDiscard: async () => false,   // user says "don't discard"
    })
    await svc.NewSolution('/work/a')
    svc.ActiveSolution!.AddMember('./x', 'architecture')   // now dirty
    const first = svc.ActiveSolution
    await svc.NewSolution('/work/b')   // should be blocked
    assert.equal(svc.ActiveSolution, first)
})
