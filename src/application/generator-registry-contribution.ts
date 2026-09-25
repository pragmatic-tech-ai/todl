/**
 * Assembles the `ProjectGeneratorRegistry` from every factory-declared generator
 * (via `IGeneratingProjectFactory.Generators()`) plus any build-registered extras,
 * registers it and a `ProjectEvents` bus into the composition, and subscribes a
 * `GeneratorScheduler` onto that bus so lifecycle events reach generators.
 */

import type { CompositionRoot } from "@pragmatic-tech-ai/todl-runtime";
import type { IContributionSource } from "./contribution-source.js";
import { type IProjectFactory, providesGenerators } from "../solution-services/project-services/core/project-factory.js";
import {
    type IProjectContentGenerator,
    type GeneratorContext,
    GeneratorTrigger,
} from "../solution-services/project-services/generators/project-content-generator.js";
import {
    ProjectGeneratorRegistry,
    ProjectGeneratorRegistryKey,
} from "../solution-services/project-services/generators/project-generator-registry.js";
import { ProjectEvents, ProjectEventsKey, type ProjectEvent } from "../solution-services/project-services/generators/project-events.js";
import { GeneratorScheduler } from "../solution-services/project-services/generators/generator-scheduler.js";
import { ProjectModelProvider } from "../solution-services/project-services/generators/project-model-provider.js";
import { DiagnosticSink } from "../solution-services/build-system-core/diagnostic-sink.js";
import type { IPackageSource, SourcedPackage } from "../solution-services/todl-build-system/package-source.js";
import type { PackageRef } from "../publish/publish.js";

// A build-system-registered generator: one not declared by any project factory (an
// app-level generator layered on top of the ones factories own).
export interface BuildRegisteredGenerator
{
    readonly ProjectType: string;
    readonly Generator: IProjectContentGenerator;
}

export interface GeneratorContributionOptions
{
    /** Build-system-registered generators, layered on top of factory-declared ones. */
    readonly Extra?: readonly BuildRegisteredGenerator[];
    /** The real base-model source. Omitted ⇒ EmptySource (no bases resolve; ruling R5). */
    readonly Source?: IPackageSource;
}

// A package source with nothing in it. Composition falls back to this when no host
// `Source` is supplied, so a generator's model compile still runs (against zero
// resolved bases) rather than needing a null check at every call site.
class EmptySource implements IPackageSource
{
    public TryGet(_ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        return Promise.resolve(undefined);
    }
}

export class GeneratorRegistryContribution implements IContributionSource
{
    public constructor(
        private readonly factories: readonly IProjectFactory[],
        private readonly options: GeneratorContributionOptions = {})
    {
    }

    public Contribute(root: CompositionRoot): void
    {
        const registry = this.BuildRegistry();
        root.Provider.registerInstance(ProjectGeneratorRegistryKey, registry);

        const events = new ProjectEvents();
        const scheduler = new GeneratorScheduler(registry, (event, reason) => this.BuildContext(event, reason));
        events.Subscribe((event) => scheduler.Handle(event));
        root.Provider.registerInstance(ProjectEventsKey, events);
    }

    private BuildRegistry(): ProjectGeneratorRegistry
    {
        const registry = new ProjectGeneratorRegistry();
        for (const factory of this.factories)
        {
            if (providesGenerators(factory))
            {
                for (const generator of factory.Generators())
                {
                    registry.Register(factory.typeId, generator);
                }
            }
        }
        for (const entry of this.options.Extra ?? [])
        {
            registry.Register(entry.ProjectType, entry.Generator);
        }
        return registry;
    }

    private BuildContext(event: ProjectEvent, reason: GeneratorTrigger): GeneratorContext
    {
        const source = this.options.Source ?? new EmptySource();
        return {
            Project: event.Project,
            Manifest: event.Manifest,
            Model: new ProjectModelProvider(event.Project, event.Manifest, source),
            Diagnostics: new DiagnosticSink(),
            Reason: reason,
        };
    }
}
