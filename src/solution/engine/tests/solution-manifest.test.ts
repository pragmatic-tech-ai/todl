import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SolutionManifest } from '../solution-manifest.js'

const SAMPLE = JSON.stringify({
    kind: 'todl-solution', version: 1, name: 'My Solution',
    members: [{ path: './api', type: 'architecture' }, { path: '../lib', type: 'library' }],
    settings: { 'npm-registry': { registry: 'https://x', org: 'acme' } },
})

test('parse exposes name/members/settings', () => {
    const m = SolutionManifest.parse(SAMPLE)
    assert.equal(m.name, 'My Solution')
    assert.equal(m.members.length, 2)
    assert.equal(m.members[0]!.path, './api')
    assert.equal(m.members[0]!.type, 'architecture')
    assert.deepEqual(m.settings['npm-registry'], { registry: 'https://x', org: 'acme' })
})

test('parse → stringify round-trips content', () => {
    const m = SolutionManifest.parse(SAMPLE)
    assert.deepEqual(JSON.parse(m.stringify()), JSON.parse(SAMPLE))
})

test('unknown member type is preserved, not dropped', () => {
    const m = SolutionManifest.parse(JSON.stringify({
        kind: 'todl-solution', version: 1, name: 'S',
        members: [{ path: './x', type: 'not-installed' }], settings: {},
    }))
    assert.equal(m.members[0]!.type, 'not-installed')
    assert.match(m.stringify(), /not-installed/)
})

test('wrong kind throws', () => {
    assert.throws(() => SolutionManifest.parse(JSON.stringify({ kind: 'nope', version: 1 })), /kind/i)
})

test('future major version is rejected', () => {
    assert.throws(() => SolutionManifest.parse(JSON.stringify({ kind: 'todl-solution', version: 2 })), /newer version/)
})

test('paths normalize to POSIX on stringify (no backslashes)', () => {
    const m = SolutionManifest.parse(JSON.stringify({
        kind: 'todl-solution', version: 1, name: 'S',
        members: [{ path: '.\\api\\sub', type: 'architecture' }], settings: {},
    }))
    assert.match(m.stringify(), /api\/sub/)
    assert.doesNotMatch(m.stringify(), /\\\\/)
})

test('create makes an empty solution', () => {
    const m = SolutionManifest.create('Fresh')
    assert.equal(m.name, 'Fresh')
    assert.deepEqual(m.members, [])
    assert.deepEqual(m.settings, {})
})
