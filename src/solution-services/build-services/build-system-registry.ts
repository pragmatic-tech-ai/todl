import type { ArtifactKey } from "./artifact-key.js";
import type { IBuildSystem } from "./build-system.js";
import type { ProjectManifest } from "../package-manager/manifest.js";

// The module-contributed registry of build systems (spec §5). Registration validates
// the action list's consume-before-produce ordering (spec §10 I/O decision) and
// rejects duplicate ids. `For` filters to the systems applicable to a project.
export class BuildSystemRegistry
{
    private static readonly DuplicateIdPrefix = "build system already registered:";
    private static readonly UnsatisfiedConsumePrefix = "invalid build system";

    private readonly systems = new Map<string, IBuildSystem>();

    public Register(system: IBuildSystem): void
    {
        if (this.systems.has(system.Id))
        {
            throw new Error(`${BuildSystemRegistry.DuplicateIdPrefix} ${system.Id}`);
        }
        BuildSystemRegistry.Validate(system);
        this.systems.set(system.Id, system);
    }

    public Get(id: string): IBuildSystem | undefined
    {
        return this.systems.get(id);
    }

    public Systems(): readonly IBuildSystem[]
    {
        return [...this.systems.values()];
    }

    public For(manifest: ProjectManifest): readonly IBuildSystem[]
    {
        return this.Systems().filter((s) => s.AppliesTo(manifest));
    }

    // Every action's Consumes key must be Produced by an earlier action in the list.
    private static Validate(system: IBuildSystem): void
    {
        const produced = new Set<ArtifactKey<unknown>>();
        for (const action of system.Actions())
        {
            for (const key of action.Consumes)
            {
                if (!produced.has(key))
                {
                    throw new Error(
                        `${BuildSystemRegistry.UnsatisfiedConsumePrefix} "${system.Id}": action "${action.Name}" consumes ${key.Description} before any earlier action produces it`,
                    );
                }
            }
            for (const key of action.Produces) produced.add(key);
        }
    }
}
