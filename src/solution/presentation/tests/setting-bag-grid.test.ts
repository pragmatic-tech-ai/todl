import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SettingDefinition, SettingKind, PropertyKind } from '@pragmatic-tech-ai/mural/framework'
import { SettingBagDefinition } from '../../engine/setting-bag-definition.js'
import { SolutionSettingBag } from '../../engine/solution-setting-bag.js'
import { SettingBagGrid } from '../setting-bag-grid.js'

function field(key: string, kind: SettingKind, def: unknown): SettingDefinition {
    const d = new SettingDefinition()
    d.Key = key; d.Kind = kind; d.Default = def; d.Label = key
    return d
}

test('kindOf maps SettingKind → PropertyKind', () => {
    assert.equal(SettingBagGrid.kindOf(SettingKind.Boolean), PropertyKind.Boolean)
    assert.equal(SettingBagGrid.kindOf(SettingKind.Number), PropertyKind.Number)
    assert.equal(SettingBagGrid.kindOf(SettingKind.Choice), PropertyKind.Enum)
    assert.equal(SettingBagGrid.kindOf(SettingKind.String), PropertyKind.Text)
    assert.equal(SettingBagGrid.kindOf(SettingKind.FilePath), PropertyKind.Text)
    assert.equal(SettingBagGrid.kindOf(SettingKind.Color), PropertyKind.Color)
})

test('describe yields one GridProperty per field with the mapped kind + category', () => {
    const def = new SettingBagDefinition('npm', 'NPM', [
        field('registry', SettingKind.String, ''),
        field('secure', SettingKind.Boolean, true),
    ])
    const bag = new SolutionSettingBag(def, undefined, () => {})
    const props = SettingBagGrid.describe(bag)
    assert.equal(props.length, 2)
    assert.equal(props[0]!.Kind, PropertyKind.Text)
    assert.equal(props[0]!.Category, 'NPM')
    assert.equal(props[1]!.Kind, PropertyKind.Boolean)
})

test('bagOf reads and writes through the SolutionSettingBag', () => {
    const def = new SettingBagDefinition('npm', 'NPM', [field('registry', SettingKind.String, 'd')])
    let changed = false
    const bag = new SolutionSettingBag(def, undefined, () => { changed = true })
    const pbag = SettingBagGrid.bagOf(bag)
    assert.equal(pbag.GetValue('registry'), 'd')
    pbag.SetValue('registry', 'https://custom')
    assert.equal(bag.Get('registry'), 'https://custom')
    assert.equal(changed, true)
    assert.equal(pbag.IsReadOnly('registry'), false)
})
