import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// P2: no engine file may import the UI framework (@pragmatic-tech-ai/mural/framework).
// mural/runtime (ServiceBase, ObservableCollection) and todl-runtime are allowed.
// setting-bag-definition.ts is the single documented exception (imports the
// SettingDefinition schema type — known debt to relocate to runtime).
const ALLOWLIST = new Set(['setting-bag-definition.ts'])

test('no engine file imports the mural UI framework', () => {
    const engineDir = dirname(dirname(fileURLToPath(import.meta.url)))   // …/engine
    const offenders: string[] = []
    for (const name of readdirSync(engineDir)) {
        if (!name.endsWith('.ts')) continue
        if (ALLOWLIST.has(name)) continue
        const text = readFileSync(join(engineDir, name), 'utf8')
        if (text.includes('@pragmatic-tech-ai/mural/framework')) offenders.push(name)
    }
    assert.deepEqual(offenders, [], `engine files importing the UI framework: ${offenders.join(', ')}`)
})
