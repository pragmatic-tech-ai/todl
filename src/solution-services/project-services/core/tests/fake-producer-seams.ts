import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { PackageKind } from '../../../../publish/publish.js'
import { type TodlDocument } from '../../../../emit/json.js'
import { type IPresentationBaker, type BakeOptions, type BakeResult } from '../presentation-baker.js'
import { type IProducerStorageBackends } from '../producer-backends.js'

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

// A backends test double: hands back the storages it was constructed with, keyed by
// producer kind, so a publish writes into real (temp-dir) backends a test can read.
export class FakeProducerBackends implements IProducerStorageBackends
{
    constructor(private readonly metaModels: IStorage, private readonly libraries: IStorage) {}

    Backend(kind: PackageKind): IStorage
    {
        return kind === PackageKind.Library ? this.libraries : this.metaModels
    }
}
