import { type IServiceProvider, ServiceKey } from "@pragmatic-tech-ai/todl-runtime";
import { type IProjectContentGenerator } from "./project-content-generator.js";
import { type GeneratorDefinition } from "./generator-definition.js";

export class ProjectGeneratorRegistry
{
    private readonly byType = new Map<string, IProjectContentGenerator[]>();
    private readonly byId = new Map<string, IProjectContentGenerator>();

    public Register(projectType: string, generator: IProjectContentGenerator): void
    {
        if (this.byId.has(generator.Id)) return
        const list = this.byType.get(projectType) ?? [];
        list.push(generator);
        this.byType.set(projectType, list);
        this.byId.set(generator.Id, generator);
    }

    public RegisterDefinition(provider: IServiceProvider, def: GeneratorDefinition): void
    {
        this.Register(def.ProjectType, provider.getRequired(def.Generator));
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

// Service token composition registers the assembled registry under, so factories and
// hosts can resolve it without importing the composition module that built it.
export const ProjectGeneratorRegistryKey = new ServiceKey<ProjectGeneratorRegistry>("ProjectGeneratorRegistry");
