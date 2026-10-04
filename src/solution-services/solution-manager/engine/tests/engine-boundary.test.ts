import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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

    const offenders = BoundaryScan.Collect(solutionServicesRoot, testFileUrl)

    assert.deepEqual(
        offenders,
        [],
        `solution-services files importing ${ForbiddenImport}:\n${offenders.join('\n')}`
    )
})

// Project-explorer-retirement engine files: must exist and must not import
// ANY mural module (UI-free, depend only on todl-runtime).
const MemberOpsEngineFiles = [
    'project-services/content/unique-name.ts',
    'project-services/content/member-content-ops.ts',
    'project-services/content/content-lifecycle.ts',
    'project-services/core/member-project-ops.ts',
    'project-services/core/semver.ts',
    'project-services/references/reference-editor.ts',
    'property-bags/connection-selection.ts',
    'solution-manager/engine/project-lifecycle.ts'
]
const AnyMuralImport = '@pragmatic-tech-ai/mural'

test('member-ops / lifecycle engine files exist and import no mural module', () =>
{
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
    for (const rel of MemberOpsEngineFiles)
    {
        const full = join(root, rel)
        assert.ok(existsSync(full), `missing engine file ${rel}`)
        assert.ok(!readFileSync(full, 'utf8').includes(AnyMuralImport), `${rel} imports ${AnyMuralImport}`)
    }
})

// Recursively collects the relative paths of solution-services .ts files that
// import the forbidden mural UI framework, skipping this guard file itself.
class BoundaryScan
{
    public static Collect(root: string, guardPath: string): string[]
    {
        const offenders: string[] = []
        BoundaryScan.walk(root, root, guardPath, offenders)
        return offenders
    }

    private static walk(current: string, root: string, guardPath: string, offenders: string[]): void
    {
        for (const entry of readdirSync(current, { withFileTypes: true }))
        {
            const fullPath = join(current, entry.name)
            if (fullPath === guardPath) continue

            if (entry.isDirectory())
            {
                BoundaryScan.walk(fullPath, root, guardPath, offenders)
            }
            else if (entry.name.endsWith(TsFileExtension))
            {
                if (ALLOWLIST.has(entry.name)) continue
                if (readFileSync(fullPath, 'utf8').includes(ForbiddenImport))
                {
                    offenders.push(relative(root, fullPath))
                }
            }
        }
    }
}
