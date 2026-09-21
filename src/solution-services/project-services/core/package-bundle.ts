import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { deriveClasses as todlDeriveClasses, type PublishedClass as TodlPublishedClass } from '../../../publish/reflect.js'
import { type TodlDocument } from '../../../compiler-services/emit/json.js'
import { type PublishedBaseModelReference } from './base-binding.js'

// One instantiable class a published package provides — a palette item. The
// model-derived fields (id/localId/label/icon/concept) come from TODL's PublishedClass;
// the bundle adds the resource paths, attached later (present only when the
// conventionally-named file exists).
export interface PublishedClass extends TodlPublishedClass
{
    template?: string     // "visuals/<id>.mural"    — present only if the file exists
    thumbnail?: string    // "thumbnails/<id>.png"   — present only if the file exists
    doc?: string          // "docs/<id>.md"          — present only if the file exists
}

// The unified bundle.json — the index a consumer reads to discover and mount a published
// package. Meta-models and libraries emit the same shape (a meta-model simply tends to
// have empty bindings/classes): identity + the base references it was authored against +
// palette classes + resource-folder listings + package-level annotations (so a consumer
// understands a package without parsing model.json).
export interface PackageBundle
{
    // The user-facing project type this package was published from ('meta-model' |
    // 'library'). Meta-models and libraries are identical internally, so a single
    // bundle.json is emitted for both; this field is the discriminator a consumer uses to
    // present them in their (separately-managed) surfaces.
    type: string
    id: string
    version: string
    name: string
    description?: string
    metaModels: readonly PublishedBaseModelReference[]
    libraries: readonly PublishedBaseModelReference[]
    classes: readonly PublishedClass[]
    assets: readonly string[]
    docs: readonly string[]
    samples: readonly string[]
    annotations: Record<string, Record<string, unknown>>
}

export interface ScannedResources
{
    byClass: Map<string, { template?: string; thumbnail?: string; doc?: string }>
    assets: string[]
    docs: string[]
    samples: string[]
    warnings: string[]
}

// Discovery of a producer package's instantiable classes + its reserved resource folders.
// Shared by every producer project (meta-model and library are the same internally).
export class ProducerResources
{
    // The instantiable classes a package provides. The derivation (Instance-tier
    // clabjects with `attrs.class === true`, label + annotation icon) lives in TODL core
    // (deriveClasses); this delegates and widens the result so resource paths can be
    // attached at publish time.
    public static DeriveClasses(model: TodlDocument): PublishedClass[]
    {
        return todlDeriveClasses(model)
    }

    // Scan the reserved resource folders and bind files to classes by filename convention
    // (stem = class id): visuals/<id>.mural, thumbnails/<id>.png, docs/<id>.md attach to a
    // known class; every asset/doc/sample file is also listed for the bundle. A
    // visuals/thumbnails file whose stem is not a known class id is an orphan — warned,
    // never fatal. A missing folder lists as empty.
    public static async Scan(storage: IStorage, classIds: readonly string[]): Promise<ScannedResources>
    {
        const known = new Set(classIds)
        const byClass = new Map<string, { template?: string; thumbnail?: string; doc?: string }>()
        const warnings: string[] = []

        const ensure = (id: string): { template?: string; thumbnail?: string; doc?: string } => {
            let e = byClass.get(id)
            if (e === undefined) { e = {}; byClass.set(id, e) }
            return e
        }
        const files = async (dir: string): Promise<string[]> => {
            const names: string[] = []
            for (const e of await storage.List(dir)) if (!e.IsDirectory) names.push(e.Name)
            return names
        }
        const stem = (name: string): string => {
            const i = name.lastIndexOf('.')
            return i > 0 ? name.slice(0, i) : name
        }

        for (const name of await files('visuals'))
        {
            if (!name.endsWith('.mural')) continue
            const id = stem(name)
            if (known.has(id)) ensure(id).template = `visuals/${name}`
            else warnings.push(`visuals/${name} targets unknown class "${id}"`)
        }
        for (const name of await files('thumbnails'))
        {
            const id = stem(name)
            if (known.has(id)) ensure(id).thumbnail = `thumbnails/${name}`
            else warnings.push(`thumbnails/${name} targets unknown class "${id}"`)
        }
        for (const name of await files('docs'))
        {
            const id = stem(name)
            if (name.endsWith('.md') && known.has(id)) ensure(id).doc = `docs/${name}`
        }

        const assets = (await files('assets')).map((n) => `assets/${n}`)
        const docs = (await files('docs')).map((n) => `docs/${n}`)
        const samples = (await files('samples')).map((n) => `samples/${n}`)
        return { byClass, assets, docs, samples, warnings }
    }
}
