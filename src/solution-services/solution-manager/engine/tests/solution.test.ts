import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { Solution } from '../solution.js'
import { SolutionMemberStatus } from '../solution-member-status.js'

test('AddMember appends and marks dirty', () => {
    const s = new Solution('S', new FakeStorage())
    assert.equal(s.IsDirty, false)
    const m = s.AddMember('./api', 'architecture')
    assert.equal(s.Members.Count, 1)
    assert.equal(m.Ref.path, './api')
    assert.equal(m.Ref.type, 'architecture')
    assert.equal(s.IsDirty, true)
})

test('RemoveMember drops it and marks dirty', () => {
    const s = new Solution('S', new FakeStorage())
    const m = s.AddMember('./api', 'architecture')
    s.IsDirty = false
    s.RemoveMember(m)
    assert.equal(s.Members.Count, 0)
    assert.equal(s.IsDirty, true)
})

test('setting Name raises PropertyChanged and marks dirty', () => {
    const s = new Solution('S', new FakeStorage())
    let fired = false
    s.PropertyChanged('Name').subscribe(() => { fired = true })
    s.Name = 'Renamed'
    assert.equal(fired, true)
    assert.equal(s.Name, 'Renamed')
    assert.equal(s.IsDirty, true)
})

test('a fresh member is Unopened; IsResolved tracks Status Resolved', () => {
    const s = new Solution('S', new FakeStorage())
    const m = s.AddMember('./api', 'architecture')
    assert.equal(m.Status, SolutionMemberStatus.Unopened)
    assert.equal(m.IsResolved, false)
    m.Status = SolutionMemberStatus.Resolved
    assert.equal(m.IsResolved, true)
})
