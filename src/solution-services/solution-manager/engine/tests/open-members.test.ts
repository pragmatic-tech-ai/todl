import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { Solution } from '../solution.js'
import { FakeProjectFactory } from './fake-project-factory.js'

test('OpenMembers resolves known types, leaves unknown unresolved', async () => {
    const s = new Solution('S', new FakeStorage())
    s.AddMember('./api', 'architecture')
    s.AddMember('./x', 'not-installed')
    const arch = new FakeProjectFactory()
    await s.OpenMembers(
        () => new FakeStorage(),
        (type) => (type === 'architecture' ? arch : undefined),
    )
    const [m0, m1] = s.Members.ToArray()
    assert.equal(m0!.IsResolved, true)
    assert.equal(m1!.IsResolved, false)
    assert.equal(arch.openCount, 1)
})

test('OpenMembers passes a member-rooted storage to the factory', async () => {
    const s = new Solution('S', new FakeStorage())
    s.AddMember('./api', 'architecture')
    const arch = new FakeProjectFactory()
    const roots: string[] = []
    await s.OpenMembers(
        (rel) => { const st = new FakeStorage(`root:${rel}`); return st },
        () => arch,
    )
    assert.equal(arch.lastOpenedRoot, 'root:./api')
})

test('OpenMembers stashes each resolved member storage; unresolved stays undefined', async () => {
    const s = new Solution('S', new FakeStorage())
    s.AddMember('./api', 'architecture')
    s.AddMember('./x', 'not-installed')
    const arch = new FakeProjectFactory()
    const stores = new Map<string, FakeStorage>()
    await s.OpenMembers(
        (rel) => {
            const st = new FakeStorage(`root:${rel}`)
            stores.set(rel, st)
            return st
        },
        (type) => (type === 'architecture' ? arch : undefined),
    )
    const [known, unknown] = s.Members.ToArray()
    assert.equal(known!.Storage, stores.get('./api'))
    assert.equal(known!.IsResolved, true)
    assert.equal(unknown!.Storage, undefined)
    assert.equal(unknown!.IsResolved, false)
})

test('OpenOne opens a single member; OpenMembers delegates to it', async () => {
    const s = new Solution('S', new FakeStorage())
    const m = s.AddMember('./api', 'architecture')
    const arch = new FakeProjectFactory()
    await s.OpenOne(m, (rel) => new FakeStorage(`root:${rel}`), () => arch)
    assert.equal(m.IsResolved, true)
    assert.equal(m.Storage!.Root, 'root:./api')
    assert.equal(arch.openCount, 1)
})

test('OpenOne leaves a member with no factory unresolved', async () => {
    const s = new Solution('S', new FakeStorage())
    const m = s.AddMember('./x', 'not-installed')
    await s.OpenOne(m, () => new FakeStorage(), () => undefined)
    assert.equal(m.IsResolved, false)
    assert.equal(m.Storage, undefined)
})
