import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'

export enum WikiOriginKind
{
    OpenProject = 'openProject',
    Package = 'package',
}

// Where a concept's declaring artifact lives — the base a relative wiki path
// resolves against. Produced by base resolution (per base, open source vs
// published package) and consumed by the wiki opener.
export type WikiOrigin =
    | { readonly kind: WikiOriginKind.OpenProject; readonly storage: IStorage }
    | { readonly kind: WikiOriginKind.Package; readonly id: string; readonly version: string }

export class WikiLocator
{
    public static OpenProjectOrigin(storage: IStorage): WikiOrigin
    {
        return { kind: WikiOriginKind.OpenProject, storage }
    }

    public static PackageOrigin(id: string, version: string): WikiOrigin
    {
        return { kind: WikiOriginKind.Package, id, version }
    }

    // `<id>/<version>/<relPath>` — a page path inside a published package bundle.
    public static PackageWikiPath(id: string, version: string, relPath: string): string
    {
        return `${id}/${version}/${relPath}`
    }

    // Resolve a wiki `relPath` (relative to its declaring artifact) + origin into
    // the concrete storage + storage-relative path. Open source reads from the
    // project's own storage; a published concept reads from `packagesStorage`
    // (the single packages backend) at `<id>/<version>/<relPath>`. The caller
    // supplies packagesStorage (host-free: no backend lookup here).
    public static LocateFile(
        packagesStorage: IStorage, origin: WikiOrigin, relPath: string,
    ): { storage: IStorage; path: string }
    {
        if (origin.kind === WikiOriginKind.OpenProject)
        {
            return { storage: origin.storage, path: relPath }
        }
        return { storage: packagesStorage, path: WikiLocator.PackageWikiPath(origin.id, origin.version, relPath) }
    }
}
