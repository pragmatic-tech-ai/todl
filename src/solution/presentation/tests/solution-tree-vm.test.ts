import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionViewService } from '../../engine/solution-view-service.js'
import { SolutionTreeVM } from '../solution-tree-vm.js'

test('tree has one root per member; unresolved flagged', () => {
    const s = new SolutionViewService('S', new FakeStorage())
    const a = s.AddMember('./api', 'architecture')
    a.Project = { kind: 'fake' }          // resolved
    s.AddMember('./x', 'missing')         // unresolved (no Project)
    const tree = new SolutionTreeVM(s, () => new FakeStorage())
    const roots = tree.Roots.ToArray()
    assert.equal(roots.length, 2)
    assert.equal(roots[0]!.IsResolved, true)
    assert.equal(roots[1]!.IsResolved, false)
})

test('expanding a resolved member lists its folder structure (folders first)', async () => {
    const s = new SolutionViewService('S', new FakeStorage())
    const a = s.AddMember('./api', 'architecture'); a.Project = {}
    const storage = new FakeStorage()
    await storage.WriteText('src/main.todl', 'x')
    await storage.WriteText('project.plexus', '{}')
    const tree = new SolutionTreeVM(s, () => storage)
    const root = tree.Roots.ToArray()[0]!
    await root.OnExpand()
    const children = root.Children!.ToArray()
    const names = children.map((c) => c.Title)
    assert.ok(names.includes('src'))
    assert.ok(names.includes('project.plexus'))
    // folders sort before files
    assert.equal(children[0]!.Title, 'src')
    assert.equal(children[0]!.IsDirectory, true)
})

test('a file node has no children and expands to nothing', async () => {
    const s = new SolutionViewService('S', new FakeStorage())
    const a = s.AddMember('./api', 'architecture'); a.Project = {}
    const storage = new FakeStorage()
    await storage.WriteText('readme.md', 'hi')
    const tree = new SolutionTreeVM(s, () => storage)
    const root = tree.Roots.ToArray()[0]!
    await root.OnExpand()
    const file = root.Children!.ToArray().find((c) => c.Title === 'readme.md')!
    assert.equal(file.IsDirectory, false)
    assert.equal(file.Children, undefined)
})

test('an unresolved member does not expand', async () => {
    const s = new SolutionViewService('S', new FakeStorage())
    s.AddMember('./x', 'missing')
    const tree = new SolutionTreeVM(s, () => new FakeStorage())
    const root = tree.Roots.ToArray()[0]!
    await root.OnExpand()
    assert.equal(root.Children, undefined)
})
