// A member project's manifest entry: a relative POSIX path + its project type id.
export interface SolutionMemberRef
{
    path: string
    type: string
}

// Path helpers as static methods (no module-level free functions).
export class SolutionPath
{
    // Normalize a path to relative POSIX form: `\` → `/`, collapse repeats/`.`,
    // preserve leading `./` and `../` segments. Never emits a backslash.
    static toPosix(p: string): string
    {
        const raw = p.split(/[\\/]+/)
        // Keep a leading run of '..' at the front; drop '' and '.' noise.
        let prefix = ''
        let i = 0
        while (i < raw.length && (raw[i] === '..' || raw[i] === '' || raw[i] === '.'))
        {
            if (raw[i] === '..') prefix += '../'
            i++
        }
        const body = raw.slice(i).filter((s) => s !== '' && s !== '.' && s !== '..').join('/')
        if (prefix !== '') return prefix + body
        // No leading '..': preserve a single './' only if the original was explicitly relative.
        const wasDotRelative = /^\.\//.test(p) || p === '.'
        return (wasDotRelative ? './' : '') + body
    }

    static isRelative(p: string): boolean
    {
        return !/^([a-zA-Z]:[\\/]|[\\/])/.test(p)
    }
}
