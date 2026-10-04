import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type TodlDocument } from '../../../compiler-services/emit/json.js'
import { type ProjectType, type DependencyRef } from '../../package-manager/manifest.js'
import { type WikiOrigin } from '../../project-services/core/wiki-origin.js'

// The engine's base-resolution contract: the surface the live-first SolutionBaseResolver
// exposes and every engine op (MemberProjectOps, ReferenceEditor) consumes. A higher
// layer (the SolutionLanguageService facade) also implements it, so a host can route
// base resolution through the registered language service wherever the concrete resolver
// was once required — without the engine ever depending on that higher layer.
export interface IBaseResolver
{
    ResolveBasesFor(consumerStorage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[]; originOf: ReadonlyMap<string, WikiOrigin> }>
    ReferencedPublishedRefs(consumerStorage: IStorage): Promise<Set<string>>
    WorkspaceProducers(kind: ProjectType): Promise<readonly DependencyRef[]>
    ProducedIdOf(consumerStorage: IStorage): Promise<string | undefined>
    ConsumerIdOf(consumerStorage: IStorage): Promise<string | undefined>
    Invalidate(memberId: string): void
}
