// Pure semver bump + validation for producer project versions. No I/O.

export enum VersionPart
{
    Major = 'major',
    Minor = 'minor',
    Patch = 'patch',
}

export class SemVer
{
    private static readonly SegmentSeparator = '.'
    private static readonly SafeSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

    // Increment the chosen part, zeroing the lower parts. Lenient: a version with
    // missing or non-numeric parts coerces those parts to 0 (so it never throws) -
    // '5' -> [5,0,0], '' -> [0,0,0].
    public static Bump(current: string, part: VersionPart): string
    {
        const seg = current.split(SemVer.SegmentSeparator)
        const major = Number(seg[0]) || 0
        const minor = Number(seg[1]) || 0
        const patch = Number(seg[2]) || 0
        switch (part)
        {
            case VersionPart.Major: return `${major + 1}.0.0`
            case VersionPart.Minor: return `${major}.${minor + 1}.0`
            case VersionPart.Patch: return `${major}.${minor}.${patch + 1}`
        }
    }

    // A version is usable iff it is non-empty and safe as a single path segment (it
    // becomes the <id>/<version>/ folder name): starts alphanumeric, then only
    // alphanumerics, dot, underscore, hyphen. No slashes, no leading dot.
    public static IsValid(version: string): boolean
    {
        return SemVer.SafeSegmentPattern.test(version.trim())
    }
}
