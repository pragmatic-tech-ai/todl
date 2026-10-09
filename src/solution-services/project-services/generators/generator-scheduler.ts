/**
 * Maps a raised `ProjectEvent` to the `GeneratorTrigger` it stands for and runs every
 * registered generator whose `Triggers` include it. `Opened` is special-cased into a
 * backfill pass whose behavior follows the generator's `WritePolicy`: an `Overwrite`
 * generator owns its output (machine-generated, "Do not edit") and re-emits on every
 * open so a stale artifact left by an older generator heals; any other policy scaffolds
 * a user-owned file and runs only when every one of its `Produces` paths is still
 * missing, so present files are never overwritten. `Saved` maps to no trigger in Phase 1
 * and is ignored.
 */

import { type ProjectGeneratorRegistry } from "./project-generator-registry.js";
import { type IProjectContentGenerator, type GeneratorContext, GeneratorTrigger, WritePolicy } from "./project-content-generator.js";
import { type ProjectEvent, ProjectEventKind } from "./project-events.js";

// Given an event and the trigger it maps to, produce the context a generator runs with
// (a fresh model provider + diagnostic sink live behind this seam — supplied by composition).
export type GeneratorContextFactory = (event: ProjectEvent, reason: GeneratorTrigger) => GeneratorContext;

export class GeneratorScheduler
{
    public constructor(
        private readonly registry: ProjectGeneratorRegistry,
        private readonly contextFactory: GeneratorContextFactory)
    {
    }

    public async Handle(event: ProjectEvent): Promise<void>
    {
        if (event.Kind === ProjectEventKind.Opened)
        {
            await this.Backfill(event);
            return;
        }

        const trigger = GeneratorScheduler.MapTrigger(event.Kind);
        if (trigger === undefined)
        {
            return;
        }

        for (const generator of this.registry.For(event.ProjectType))
        {
            if (generator.Triggers.includes(trigger))
            {
                await generator.Generate(this.contextFactory(event, trigger));
            }
        }
    }

    // Opened heals a project. An Overwrite generator owns its output ("Do not edit"), so
    // it re-emits on every open — that is how a stale artifact from an older generator
    // heals. Any other policy scaffolds a user-owned file and runs only when EVERY
    // produced path is missing, so present files are never overwritten. WritePolicyWriter
    // is the second guard that honors each policy at write time.
    private async Backfill(event: ProjectEvent): Promise<void>
    {
        for (const generator of this.registry.For(event.ProjectType))
        {
            if (await GeneratorScheduler.ShouldBackfill(generator, event))
            {
                await generator.Generate(this.contextFactory(event, GeneratorTrigger.OnDemand));
            }
        }
    }

    private static async ShouldBackfill(generator: IProjectContentGenerator, event: ProjectEvent): Promise<boolean>
    {
        if (generator.WritePolicy === WritePolicy.Overwrite)
        {
            return true;
        }
        return GeneratorScheduler.AllMissing(generator, event);
    }

    private static MapTrigger(kind: ProjectEventKind): GeneratorTrigger | undefined
    {
        if (kind === ProjectEventKind.Created)
        {
            return GeneratorTrigger.ProjectCreated;
        }
        if (kind === ProjectEventKind.ReferencesChanged)
        {
            return GeneratorTrigger.ReferencesChanged;
        }
        return undefined;
    }

    private static async AllMissing(generator: IProjectContentGenerator, event: ProjectEvent): Promise<boolean>
    {
        for (const path of generator.Produces)
        {
            if (await event.Project.Exists(path))
            {
                return false;
            }
        }
        return true;
    }
}
