import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type TodlDocument } from '../../../../compiler-services/emit/json.js'
import { type IPresentationBaker, type BakeOptions, type BakeResult } from '../presentation-baker.js'

// A baker test double: records every call and returns a scripted result (ok by
// default). Standing in for the mural-compiler-backed concrete baker, so a publish
// can be exercised headlessly without the framework compiler.
export class FakePresentationBaker implements IPresentationBaker
{
    public calls: Array<{ base: string; options: BakeOptions }> = []
    constructor(private readonly result: BakeResult = { ok: true, icons: 0 }) {}

    async Bake(_project: IStorage, _dest: IStorage, base: string, _doc: TodlDocument, options: BakeOptions): Promise<BakeResult>
    {
        this.calls.push({ base, options })
        return this.result
    }
}
