import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectType, parseManifest, type DependencyRef } from '../../package-manager/manifest.js'
import { PROJECT_MANIFEST_FILENAME } from '../core/project-factory.js'
import { type IBaseResolver } from '../../solution-manager/engine/i-base-resolver.js'
import { ProjectEventKind, type IProjectEvents } from '../generators/project-events.js'

// How a declared reference currently resolves: an open workspace producer (by id),
// else a published package (exact id@version in the catalog), else not at all.
export enum ReferenceResolutionKind
{
    LiveWorkspace,
    Published,
    Unresolved,
}

// A reference choice offered by the catalog: a plain id + version pair.
export interface RefChoiceDTO
{
    readonly id: string
    readonly version: string
}

// The declared meta-model / library references of a project manifest, as plain DTOs.
export interface ReferenceManifest
{
    readonly metaModels: readonly RefChoiceDTO[]
    readonly libraries: readonly RefChoiceDTO[]
}

// The references to persist. An omitted list is left untouched in the manifest.
export interface ReferenceBindingsInput
{
    readonly metaModels?: readonly RefChoiceDTO[]
    readonly libraries?: readonly RefChoiceDTO[]
}

// The published-package catalog the editor offers choices from. Declared here (engine
// layer) so a host supplies it; absent means nothing is published.
export interface IPublishedBaseCatalog
{
    ListMetaModels(): Promise<readonly RefChoiceDTO[]>
    ListLibraries(): Promise<readonly RefChoiceDTO[]>
}

// UX-free reference editing for one member project: read the manifest's references,
// write them back (then invalidate the resolver and raise ReferencesChanged), classify
// a reference's resolution, and list the catalog of available references / versions.
export class ReferenceEditor
{
    constructor(
        private readonly resolver: IBaseResolver,
        private readonly storage: IStorage,
        private readonly published?: IPublishedBaseCatalog,
        private readonly events?: IProjectEvents,
    )
    {
    }

    public async ReadManifest(): Promise<ReferenceManifest>
    {
        const manifest = parseManifest(await this.storage.ReadText(PROJECT_MANIFEST_FILENAME))
        return {
            metaModels: ReferenceEditor.plain(manifest.metaModels),
            libraries: ReferenceEditor.plain(manifest.libraries),
        }
    }

    public async WriteReferences(bindings: ReferenceBindingsInput): Promise<void>
    {
        // Parse as a loose record so every other manifest field is preserved verbatim.
        const raw = JSON.parse(await this.storage.ReadText(PROJECT_MANIFEST_FILENAME)) as Record<string, unknown>
        if (bindings.metaModels !== undefined) raw.metaModels = ReferenceEditor.plain(bindings.metaModels)
        if (bindings.libraries !== undefined) raw.libraries = ReferenceEditor.plain(bindings.libraries)
        await this.storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(raw, null, 2))
        const id = await this.resolver.ConsumerIdOf(this.storage)
        if (id !== undefined) this.resolver.Invalidate(id)
        if (this.events !== undefined)
        {
            const manifest = parseManifest(await this.storage.ReadText(PROJECT_MANIFEST_FILENAME))
            await this.events.Raise({ Kind: ProjectEventKind.ReferencesChanged, ProjectType: manifest.type, Project: this.storage, Manifest: manifest })
        }
    }

    public async Classify(kind: ProjectType, ref: RefChoiceDTO): Promise<ReferenceResolutionKind>
    {
        const producerIds = new Set((await this.producers(kind)).map((p) => p.id))
        if (producerIds.has(ref.id)) return ReferenceResolutionKind.LiveWorkspace
        const publishedKeys = new Set((await this.catalog(kind)).map(ReferenceEditor.key))
        if (publishedKeys.has(ReferenceEditor.key(ref))) return ReferenceResolutionKind.Published
        return ReferenceResolutionKind.Unresolved
    }

    public async AvailableReferencesFor(kind: ProjectType): Promise<readonly RefChoiceDTO[]>
    {
        const manifest = await this.ReadManifest()
        const declared = kind === ProjectType.Library ? manifest.libraries : manifest.metaModels
        const declaredIds = new Set(declared.map((r) => r.id))
        const candidates = [...await this.catalog(kind), ...await this.producers(kind)]
        const out: RefChoiceDTO[] = []
        const seen = new Set<string>()
        for (const ref of candidates)
        {
            const k = ReferenceEditor.key(ref)
            // Any version of an already-declared id is excluded: changing a version is a
            // version edit, not an add (an add would append a duplicate id).
            if (declaredIds.has(ref.id) || seen.has(k)) continue
            seen.add(k)
            out.push({ id: ref.id, version: ref.version })
        }
        return out
    }

    public async AvailableVersionsFor(kind: ProjectType, id: string): Promise<readonly string[]>
    {
        const versions = new Set<string>()
        for (const ref of await this.catalog(kind)) if (ref.id === id) versions.add(ref.version)
        for (const ref of await this.producers(kind)) if (ref.id === id) versions.add(ref.version)
        return [...versions].sort(ReferenceEditor.CompareVersionsDesc)
    }

    // Descending semver-ish order (newest first). Splits off any prerelease suffix so a
    // release outranks its own prerelease (2.0.0 before 2.0.0-rc.1), compares the numeric
    // core segments (a non-numeric segment counts as 0), then orders prereleases lexically.
    public static CompareVersionsDesc(a: string, b: string): number
    {
        const [coreA, preA] = ReferenceEditor.splitVersion(a)
        const [coreB, preB] = ReferenceEditor.splitVersion(b)
        for (let i = 0; i < Math.max(coreA.length, coreB.length); i++)
        {
            const diff = (coreB[i] ?? 0) - (coreA[i] ?? 0)
            if (diff !== 0) return diff
        }
        if (preA === preB) return 0
        if (preA === '') return -1
        if (preB === '') return 1
        return preB < preA ? -1 : 1
    }

    private async catalog(kind: ProjectType): Promise<readonly RefChoiceDTO[]>
    {
        if (this.published === undefined) return []
        return kind === ProjectType.Library ? this.published.ListLibraries() : this.published.ListMetaModels()
    }

    private async producers(kind: ProjectType): Promise<readonly DependencyRef[]>
    {
        return this.resolver.WorkspaceProducers(kind)
    }

    private static plain(refs: readonly RefChoiceDTO[] | undefined): RefChoiceDTO[]
    {
        return (refs ?? []).map((r) => ({ id: r.id, version: r.version }))
    }

    private static key(ref: RefChoiceDTO): string
    {
        return `${ref.id}@${ref.version}`
    }

    private static splitVersion(v: string): [number[], string]
    {
        const dash = v.indexOf('-')
        const core = dash === -1 ? v : v.slice(0, dash)
        const pre = dash === -1 ? '' : v.slice(dash + 1)
        const parts = core.split('.').map((n) =>
        {
            const x = Number.parseInt(n, 10)
            return Number.isNaN(x) ? 0 : x
        })
        return [parts, pre]
    }
}
