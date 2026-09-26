import { type IServiceProvider, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type TodlDocument } from '../../../compiler-services/emit/json.js'
import { PresentationBakerKey, type IPresentationBaker, type BakeOptions, type BakeResult } from './presentation-baker.js'

// An IPresentationBaker that defers to whatever baker is registered under
// PresentationBakerKey AT BAKE TIME. The composer builds NpmPackageBuildSystem eagerly
// (it seeds the build-system registry during composition), so handing it a concrete
// baker would freeze the default in before any later module had a chance to swap it.
// Wrapping the provider instead keeps PresentationBakerKey a live override point: a
// host module composed after TODL's (or a test) re-registers the key, and the next
// build bakes through the override. Resolution goes through the provider that owns the
// composition, so an override must be registered on that same container.
export class ProviderPresentationBaker implements IPresentationBaker
{
    constructor(private readonly provider: IServiceProvider)
    {
    }

    public Bake(project: IStorage, dest: IStorage, base: string, document: TodlDocument, closure: TodlDocument, options: BakeOptions): Promise<BakeResult>
    {
        return this.provider.getRequired(PresentationBakerKey).Bake(project, dest, base, document, closure, options)
    }
}
