import { type SolutionMemberRef, SolutionPath } from './solution-member-ref.js'

type SettingValues = Record<string, string | number | boolean>

// The persisted shape of a solution: a name, an ordered list of member project
// references, and per-bag cross-project setting values. Parsed from / written to
// `solution.json`. Mirrors the todl package's `parseManifest` convention:
// JSON.parse + shape validation, not a schema library.
export class SolutionManifest {
    static readonly KIND = 'todl-solution'
    static readonly VERSION = 1

    constructor(
        public readonly name: string,
        public readonly members: SolutionMemberRef[],
        public readonly settings: Record<string, SettingValues>,
    ) {}

    static create(name: string): SolutionManifest {
        return new SolutionManifest(name, [], {})
    }

    static parse(text: string): SolutionManifest {
        const raw = JSON.parse(text) as Record<string, unknown>
        if (raw.kind !== SolutionManifest.KIND) {
            throw new Error(`Not a solution file (kind="${String(raw.kind)}").`)
        }
        const version = typeof raw.version === 'number' ? raw.version : 0
        if (version > SolutionManifest.VERSION) {
            throw new Error('Solution was made by a newer version of the app.')
        }
        const name = typeof raw.name === 'string' ? raw.name : 'Solution'
        const members: SolutionMemberRef[] = Array.isArray(raw.members)
            ? raw.members.map((m) => {
                const mm = m as Record<string, unknown>
                return { path: SolutionPath.toPosix(String(mm.path ?? '')), type: String(mm.type ?? '') }
            })
            : []
        const settings = (raw.settings !== null && typeof raw.settings === 'object')
            ? raw.settings as Record<string, SettingValues>
            : {}
        return new SolutionManifest(name, members, settings)
    }

    stringify(): string {
        return JSON.stringify({
            kind: SolutionManifest.KIND,
            version: SolutionManifest.VERSION,
            name: this.name,
            members: this.members.map((m) => ({ path: SolutionPath.toPosix(m.path), type: m.type })),
            settings: this.settings,
        }, null, 2)
    }
}
