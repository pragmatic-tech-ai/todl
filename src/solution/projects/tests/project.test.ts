import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Project, ProjectNode, ProjectNodeKind } from '../project.js'

test('a node exposes its constructor data and an empty child collection', () => {
    const node = new ProjectNode('api', 'src/api', ProjectNodeKind.Folder)
    assert.equal(node.Name, 'api')
    assert.equal(node.Path, 'src/api')
    assert.equal(node.Kind, ProjectNodeKind.Folder)
    assert.equal(node.Children.Count, 0)
})

test('renaming a node raises a Name change and Path can move in lock-step', () => {
    const node = new ProjectNode('old', 'src/old.todl', ProjectNodeKind.Todl)
    const seen: Array<{ o: unknown; n: unknown }> = []
    node.PropertyChanged('Name').subscribe((a) => seen.push({ o: a.oldValue, n: a.newValue }))
    node.Name = 'new'
    node.Path = 'src/new.todl'
    assert.equal(node.Name, 'new')
    assert.equal(node.Path, 'src/new.todl')
    assert.deepEqual(seen, [{ o: 'old', n: 'new' }])
})

test('setting an unchanged Name raises nothing', () => {
    const node = new ProjectNode('same', 'p', ProjectNodeKind.File)
    let raised = 0
    node.PropertyChanged('Name').subscribe(() => raised++)
    node.Name = 'same'
    assert.equal(raised, 0)
})

test('adding children notifies collection subscribers', () => {
    const root = new ProjectNode('root', '', ProjectNodeKind.Folder)
    let changes = 0
    root.Children.Subscribe(() => changes++)
    root.Children.Add(new ProjectNode('a.todl', 'a.todl', ProjectNodeKind.Todl))
    root.Children.Add(new ProjectNode('b.diagram', 'b.diagram', ProjectNodeKind.Diagram))
    assert.equal(root.Children.Count, 2)
    assert.equal(changes, 2)
    assert.equal(root.Children.Get(0)!.Name, 'a.todl')
})

test('a project exposes its type, name, root path and root node', () => {
    const root = new ProjectNode('root', '', ProjectNodeKind.Folder)
    const project = new Project('architecture', 'My Arch', '/work/arch', root)
    assert.equal(project.Type, 'architecture')
    assert.equal(project.Name, 'My Arch')
    assert.equal(project.RootPath, '/work/arch')
    assert.equal(project.Root, root)
})
