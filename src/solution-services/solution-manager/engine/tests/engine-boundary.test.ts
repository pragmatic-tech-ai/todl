import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

// P2: no file under solution-services may import the UI framework
// (@pragmatic-tech-ai/mural/framework). mural/runtime (ServiceBase,
// ObservableCollection) and todl-runtime are allowed. The bootstrapper
// exception uses mural/compiler and mural/runtime, not mural/framework.
const ALLOWLIST = new Set<string>()
const ForbiddenImport = '@pragmatic-tech-ai/mural/framework'
const TsFileExtension = '.ts'

test('no solution-services file imports the mural UI framework', () => {
    const testFileUrl = fileURLToPath(import.meta.url)
    const testDir = dirname(testFileUrl)
    const solutionServicesRoot = join(testDir, '../../..')   // …/solution-services

    const offenders: string[] = []
    CollectOffenders(solutionServicesRoot, solutionServicesRoot, testFileUrl, offenders)

    assert.deepEqual(
        offenders,
        [],
        `solution-services files importing ${ForbiddenImport}:\n${offenders.join('\n')}`
    )
})

function CollectOffenders(current: string, root: string, guardPath: string, offenders: string[]): void
{
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries)
    {
        const fullPath = join(current, entry.name)

        // Skip the guard file itself
        if (fullPath === guardPath) continue

        if (entry.isDirectory())
        {
            CollectOffenders(fullPath, root, guardPath, offenders)
        }
        else if (entry.name.endsWith(TsFileExtension))
        {
            if (ALLOWLIST.has(entry.name)) continue
            const text = readFileSync(fullPath, 'utf8')
            if (text.includes(ForbiddenImport))
            {
                // Report relative path from solution-services root for clarity
                const relPath = relative(root, fullPath)
                offenders.push(relPath)
            }
        }
    }
}
