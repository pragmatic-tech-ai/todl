import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SettingDefinition, SettingKind } from '@pragmatic-tech-ai/mural/framework'
import { SettingBagDefinition } from '../setting-bag-definition.js'
import { SolutionSettingsRegistry } from '../solution-settings-registry.js'

function field(key: string, kind = SettingKind.String, def: unknown = ''): SettingDefinition {
    const d = new SettingDefinition()
    d.Key = key; d.Kind = kind; d.Default = def; d.Label = key
    return d
}

test('Contribute is idempotent by Id', () => {
    const reg = SolutionSettingsRegistry.createForTest()
    const bag = new SettingBagDefinition('npm-registry', 'NPM Registry', [field('registry')])
    reg.Contribute(bag)
    reg.Contribute(bag)
    assert.equal(reg.Definitions.Count, 1)
    assert.equal(reg.GetById('npm-registry')!.Title, 'NPM Registry')
})

test('GetById returns undefined for an unknown bag', () => {
    const reg = SolutionSettingsRegistry.createForTest()
    assert.equal(reg.GetById('nope'), undefined)
})

test('a bag exposes its typed fields', () => {
    const bag = new SettingBagDefinition('npm-registry', 'NPM', [
        field('registry', SettingKind.String, ''),
        field('secure', SettingKind.Boolean, true),
    ])
    assert.equal(bag.Fields.length, 2)
    assert.equal(bag.Fields[1]!.Kind, SettingKind.Boolean)
})
