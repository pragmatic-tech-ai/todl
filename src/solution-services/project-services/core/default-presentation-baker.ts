import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type TodlDocument } from '../../../compiler-services/emit/json.js'
import { type IPresentationBaker, type BakeOptions, type BakeResult } from './presentation-baker.js'
import { PresentationBake } from './presentation-bake.js'

// The single default presentation baker for every TODL project type. Generic over
// BakeOptions (dictName + iconPrefix), which the producer factory / bake action
// supplies per project type. Reads icons out of `project`, compiles them via the
// mural include resolver, and writes presentation.compiled.json + icon-index.json
// into `dest` under `<base>/presentation/`. `document` (own-only) is what gets
// baked; `closure` (a compiled package's `fullDocument`) is used only to resolve
// annotation ancestry — see presentation-bake.ts. A referenced icon with no
// readable project file blocks the bake (nothing written).
export class DefaultPresentationBaker implements IPresentationBaker
{
    public Bake(project: IStorage, dest: IStorage, base: string, document: TodlDocument, closure: TodlDocument, options: BakeOptions): Promise<BakeResult>
    {
        return PresentationBake.Publish(project, dest, base, document, closure, options)
    }
}
