import { type IProjectFactory } from './project-factory.js'
import { type IProjectFactoryRegistry } from './host-services.js'

// The one project-factory registry: it holds the installed factories and answers
// both consumers — `factoryFor(typeId)` (the SolutionManagerService, opening a
// member) and `All()` (a shell's New-Project gallery). It supersedes mural's
// shell-side ProjectFactoryRegistry: because a factory is now self-describing
// (typeId/title/description), the registry needs nothing but the factory list — no
// parallel ProjectFactoryDefinition, no walk of the composed shell modules.
//
// Indexed by `typeId`; the first factory to claim a type id wins (a later duplicate
// is ignored), matching the retired registry's dedupe-by-Type behaviour.
export class ProjectFactoryRegistry implements IProjectFactoryRegistry
{
    private readonly byType = new Map<string, IProjectFactory>()

    constructor(factories: readonly IProjectFactory[])
    {
        for (const factory of factories)
        {
            if (this.byType.has(factory.typeId)) continue
            this.byType.set(factory.typeId, factory)
        }
    }

    public factoryFor(typeId: string): IProjectFactory | undefined
    {
        return this.byType.get(typeId)
    }

    public All(): readonly IProjectFactory[]
    {
        return [...this.byType.values()]
    }
}
