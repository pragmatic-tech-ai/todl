import type { ArtifactKey } from "./artifact-key.js";
import type { CoreBuildContext } from "./build-action.js";
import type { BuildFlavor } from "./build-flavor.js";
import type { IBuildSystem } from "./build-system.js";

// The module-contributed registry of build systems (spec §5). Registration validates
// the action list's consume-before-produce ordering (spec §10 I/O decision) and rejects
// duplicate ids. `For` filters to the systems applicable to a build target. Generic over
// the action-context type C and the build-target type T, so the registry names no todl
// type; a host binds both (todl uses TodlBuildContext + ProjectManifest).
export class BuildSystemRegistry<C extends CoreBuildContext, T>
{
    private static readonly DuplicateIdPrefix = "build system already registered:";
    private static readonly UnsatisfiedConsumePrefix = "invalid build system";

    private readonly systems = new Map<string, IBuildSystem<C, T>>();

    public Register(system: IBuildSystem<C, T>): void
    {
        if (this.systems.has(system.Id))
        {
            throw new Error(`${BuildSystemRegistry.DuplicateIdPrefix} ${system.Id}`);
        }
        BuildSystemRegistry.Validate(system);
        this.systems.set(system.Id, system);
    }

    public Get(id: string): IBuildSystem<C, T> | undefined
    {
        return this.systems.get(id);
    }

    public Systems(): readonly IBuildSystem<C, T>[]
    {
        return [...this.systems.values()];
    }

    public For(target: T): readonly IBuildSystem<C, T>[]
    {
        return this.Systems().filter((s) => s.AppliesTo(target));
    }

    // Resolve the flavor a request selects: the one whose Id matches `flavorId`,
    // or the system's first flavor when no id is given (backward compatibility for
    // callers that name only a system). Undefined when the id matches nothing or
    // the system exposes no flavors.
    public static SelectFlavor<C extends CoreBuildContext, T>(
        system: IBuildSystem<C, T>,
        flavorId?: string,
    ): BuildFlavor<C> | undefined
    {
        const flavors = system.Flavors();
        if (flavorId === undefined) return flavors[0];
        return flavors.find((f) => f.Id === flavorId);
    }

    // Every action's Consumes key must be Produced by an earlier action in the list.
    private static Validate<C extends CoreBuildContext, T>(system: IBuildSystem<C, T>): void
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
