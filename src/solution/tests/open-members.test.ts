import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionSession } from '../solution-session.js'
import { FakeProjectFactory } from './fake-project-factory.js'

test('OpenMembers resolves known types, leaves unknown unresolved', async () => {
    const s = new SolutionSession('S', new FakeStorage())
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
    const s = new SolutionSession('S', new FakeStorage())
    s.AddMember('./api', 'architecture')
    const arch = new FakeProjectFactory()
    const roots: string[] = []
    await s.OpenMembers(
        (rel) => { const st = new FakeStorage(`root:${rel}`); return st },
        () => arch,
    )
    assert.equal(arch.lastOpenedRoot, 'root:./api')
})
