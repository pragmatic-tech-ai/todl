import test from 'node:test'
import assert from 'node:assert/strict'
import { SolutionMember } from '../solution-member.js'

test('a member exposes an undefined Storage until set', () => {
    const m = new SolutionMember({ path: 'a/project.plexus', type: 'meta-model' })
    assert.equal(m.Storage, undefined)
})
