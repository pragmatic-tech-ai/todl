import { ServiceKey, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type TodlDocument } from '../../../compiler-services/emit/json.js'

// The seam a producer factory (meta-model, library) bakes its presentation through.
// Baking compiles the model's icons into a self-contained presentation.compiled.json
// (SVG → colored IconDefinition, raster → BitmapImage) plus an icon-index.json, and
// writes both into the backend under `<base>/presentation/`. The concrete baker runs
// the MURAL compiler's include resolver — mural-coupled, so it lives app-side and is
// resolved here by key; todl owns only this contract. A referenced icon with no
// readable project file blocks the publish (nothing is written).

// How to bake: the resources block name and the icon-index key prefix differ per
// producer (meta-model uses 'MetaModelPresentation' + 'mm:'; library uses
// 'LibraryPresentation' + '').
export interface BakeOptions
{
    dictName: string
    iconPrefix: string
}

// Ok carries how many icons were baked; failure names every referenced icon with no
// readable project file.
export type BakeResult =
    | { ok: true; icons: number }
    | { ok: false; missing: string[] }

export interface IPresentationBaker
{
    // Bake `document`'s presentation from icons read out of `project`, writing the
    // compiled artifact + icon index into `dest` under `<base>/presentation/`.
    // `document` is the own-only doc to enumerate (and, upstream of this call,
    // to stamp) — only THIS project's icons are baked. `closure` (a compiled
    // package's `fullDocument`) is used ONLY to resolve annotation ancestry (e.g.
    // the literal `icon` annotation, which extends `MuralResource` in the
    // prelude, outside any project's own nodes) — never to enumerate, so a base
    // package's own icons are never folded into this bake and resource-key
    // assignment stays deterministic regardless of which bases are present.
    Bake(project: IStorage, dest: IStorage, base: string, document: TodlDocument, closure: TodlDocument, options: BakeOptions): Promise<BakeResult>
}

export const PresentationBakerKey = new ServiceKey<IPresentationBaker>('PresentationBaker')
