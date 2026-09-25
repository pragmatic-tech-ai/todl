/**
 * Maps a raised `ProjectEvent` to the `GeneratorTrigger` it stands for and runs every
 * registered generator whose `Triggers` include it. `Opened` is special-cased into a
 * backfill pass: it runs a generator only when every one of its `Produces` paths is
 * missing from the project, so present files — hand-authored or previously generated —
 * are never overwritten. `Saved` maps to no trigger in Phase 1 and is ignored.
 */

import { type ProjectGeneratorRegistry } from "./project-generator-registry.js";
import { type IProjectContentGenerator, type GeneratorContext, GeneratorTrigger } from "./project-content-generator.js";
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

    // Opened heals a project: run each generator whose EVERY produced path is missing,
    // so present files are never overwritten. WritePolicy is a second guard.
    private async Backfill(event: ProjectEvent): Promise<void>
    {
        for (const generator of this.registry.For(event.ProjectType))
        {
            if (await GeneratorScheduler.AllMissing(generator, event))
            {
                await generator.Generate(this.contextFactory(event, GeneratorTrigger.OnDemand));
            }
        }
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
