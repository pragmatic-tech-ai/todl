import test from 'node:test'
import assert from 'node:assert/strict'
import { BagAddress, BagScope, ProjectStore } from '../bag-address.js'

test('BagAddress.Key distinguishes scope, kind, id, and project store; equal addresses give equal keys', () =>
{
    const a = new BagAddress(BagScope.Global, 'npm-connection', 'gh')
    const b = new BagAddress(BagScope.Solution, 'npm-connection', 'gh')
    const c = new BagAddress(BagScope.Project, 'npm-connection', 'gh', ProjectStore.Local)
    const d = new BagAddress(BagScope.Project, 'npm-connection', 'gh', ProjectStore.Shared)
    const keys = [a, b, c, d].map(BagAddress.Key)
    assert.equal(new Set(keys).size, 4)                       // all four distinct
    assert.equal(BagAddress.Key(a), BagAddress.Key(new BagAddress(BagScope.Global, 'npm-connection', 'gh')))
    assert.notEqual(BagAddress.Key(a), BagAddress.Key(new BagAddress(BagScope.Global, 'npm-connection', 'other')))
})
