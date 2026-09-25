import { type IProjectContentGenerator } from "./project-content-generator.js";

export class ProjectGeneratorRegistry
{
    private static readonly DuplicateIdPrefix = "generator already registered:";

    private readonly byType = new Map<string, IProjectContentGenerator[]>();
    private readonly byId = new Map<string, IProjectContentGenerator>();

    public Register(projectType: string, generator: IProjectContentGenerator): void
    {
        if (this.byId.has(generator.Id))
        {
            throw new Error(`${ProjectGeneratorRegistry.DuplicateIdPrefix} ${generator.Id}`);
        }
        const list = this.byType.get(projectType) ?? [];
        list.push(generator);
        this.byType.set(projectType, list);
        this.byId.set(generator.Id, generator);
    }

    public For(projectType: string): readonly IProjectContentGenerator[]
    {
        return this.byType.get(projectType) ?? [];
    }

    public Get(id: string): IProjectContentGenerator | undefined
    {
        return this.byId.get(id);
    }
}
