import { type ServiceToken } from '@pragmatic-tech-ai/todl-runtime'
import { type IProjectFactory } from './project-factory.js'

// Declares "project type <TypeId> is served by the factory bound to <Factory>".
// Factory is a ServiceToken so registration never forces construction — the
// registry resolves it on first lookup.
export interface ProjectFactoryDefinition
{
    readonly TypeId: string
    readonly Factory: ServiceToken<IProjectFactory>
}
