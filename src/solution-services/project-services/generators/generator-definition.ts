import { type ServiceToken } from '@pragmatic-tech-ai/todl-runtime'
import { type IProjectContentGenerator } from './project-content-generator.js'

export interface GeneratorDefinition
{
    readonly ProjectType: string
    readonly Generator: ServiceToken<IProjectContentGenerator>
}
