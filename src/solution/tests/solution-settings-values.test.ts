import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SettingDefinition, SettingKind } from '@pragmatic-tech-ai/mural/framework'
import { SettingBagDefinition } from '../setting-bag-definition.js'
import { SolutionSession } from '../solution-session.js'

function field(key: string, def: unknown): SettingDefinition {
    const d = new SettingDefinition()
    d.Key = key; d.Kind = SettingKind.String; d.Default = def
    return d
}

test('untouched bag falls back to defaults and is omitted from CollectSettings', () => {
    const s = new SolutionSession('S', new FakeStorage())
    s.BindBags([new SettingBagDefinition('npm-registry', 'NPM', [field('registry', 'https://default')])])
    const live = s.SettingBags.ToArray()[0]!
    assert.equal(live.Get('registry'), 'https://default')
    assert.deepEqual(s.CollectSettings(), {})
})

test('setting a value marks dirty and is collected', () => {
    const s = new SolutionSession('S', new FakeStorage())
    s.BindBags([new SettingBagDefinition('npm-registry', 'NPM', [field('registry', 'https://default')])])
    s.IsDirty = false
    const live = s.SettingBags.ToArray()[0]!
    live.Set('registry', 'https://custom')
    assert.equal(s.IsDirty, true)
    assert.deepEqual(s.CollectSettings(), { 'npm-registry': { registry: 'https://custom' } })
})

test('LoadSettings overlays persisted values when bags bind', () => {
    const s = new SolutionSession('S', new FakeStorage())
    s.LoadSettings({ 'npm-registry': { registry: 'https://saved' } })
    s.BindBags([new SettingBagDefinition('npm-registry', 'NPM', [field('registry', 'https://default')])])
    assert.equal(s.SettingBags.ToArray()[0]!.Get('registry'), 'https://saved')
})

test('CollectSettings preserves persisted values for bags that never bound', () => {
    const s = new SolutionSession('S', new FakeStorage())
    s.LoadSettings({ 'unknown-bag': { foo: 'bar' } })
    // no BindBags for 'unknown-bag' — must round-trip so a missing module's
    // settings are not silently dropped on save.
    assert.deepEqual(s.CollectSettings(), { 'unknown-bag': { foo: 'bar' } })
})
