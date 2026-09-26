import { type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { type IProjectFactory } from './project-factory.js'
import { type IProjectFactoryRegistry } from './host-services.js'
import { type ProjectFactoryDefinition } from '../../project-services/core/project-factory-definition.js'

// The one project-factory registry: DI-resolved, definition-populated. Holds
// ProjectFactoryDefinitions and resolves each Factory token on demand (cached),
// so registration never forces construction. Indexed by TypeId; first definition
// to claim a type id wins (a later duplicate is ignored).
export class ProjectFactoryRegistry implements IProjectFactoryRegistry
{
    private readonly defs = new Map<string, ProjectFactoryDefinition>()
    private readonly cache = new Map<string, IProjectFactory>()

    constructor(private readonly provider: IServiceProvider)
    {
    }

    public Register(def: ProjectFactoryDefinition): void
    {
        if (this.defs.has(def.TypeId)) return
        this.defs.set(def.TypeId, def)
    }

    public factoryFor(typeId: string): IProjectFactory | undefined
    {
        const def = this.defs.get(typeId)
        if (def === undefined) return undefined
        return this.resolve(typeId, def)
    }

    public All(): readonly IProjectFactory[]
    {
        return [...this.defs.entries()].map(([id, def]) => this.resolve(id, def))
    }

    private resolve(typeId: string, def: ProjectFactoryDefinition): IProjectFactory
    {
        let f = this.cache.get(typeId)
        if (f === undefined)
        {
            f = this.provider.getRequired(def.Factory)
            this.cache.set(typeId, f)
        }
        return f
    }
}
