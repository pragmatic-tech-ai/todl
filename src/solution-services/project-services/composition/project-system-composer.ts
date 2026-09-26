/**
 * The single unified seeder for the three project-system DI registries + the
 * default presentation baker + the ProjectEvents/GeneratorScheduler lifecycle —
 * ADDITIVE to the existing composition units (`solution-services-module.mu`,
 * `todl-build-system-module.mu`, `application/generator-registry-contribution.ts`),
 * which stay in place for deferred devUI/Plexus consumers. `ProjectSystemComposer`
 * is a new, self-contained composer, reused by a mural module (Task 7) and a
 * headless contribution, that stands up TODL's built-in factories/build-systems/
 * generators into a FRESH container in one call.
 */

import { type IServiceContainer, ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { ProjectFactoryRegistry } from "../../solution-manager/engine/project-factory-registry.js";
import { ProjectFactoryRegistryKey } from "../../solution-manager/engine/host-services.js";
import { BuildSystemRegistry } from "../../build-system-core/build-system-registry.js";
import type { TodlBuildContext } from "../../todl-build-system/todl-build-context.js";
import type { ProjectManifest } from "../../package-manager/manifest.js";
import { BuildSystemRegistryKey } from "./build-system-registry-key.js";
import { ProjectGeneratorRegistry, ProjectGeneratorRegistryKey } from "../generators/project-generator-registry.js";
import { ProjectEvents, ProjectEventsKey, type ProjectEvent } from "../generators/project-events.js";
import { GeneratorScheduler } from "../generators/generator-scheduler.js";
import { ProjectModelProvider } from "../generators/project-model-provider.js";
import { type GeneratorContext, GeneratorTrigger } from "../generators/project-content-generator.js";
import { DiagnosticSink } from "../../build-system-core/diagnostic-sink.js";
import { DefaultPresentationBaker } from "../core/default-presentation-baker.js";
import { PresentationBakerKey } from "../core/presentation-baker.js";
import { providesGenerators } from "../core/project-factory.js";
import type { IPackageSource, SourcedPackage } from "../../todl-build-system/package-source.js";
import type { PackageRef } from "../../../publish/publish.js";
// Built-in factories / build systems.
import { MetaModelProjectFactory } from "../meta-model-project/meta-model-project-factory.js";
import { LibraryProjectFactory } from "../library-project/library-project-factory.js";
import { ArchitectureProjectFactory } from "../architecture-project/architecture-project-factory.js";
import { NpmPackageBuildSystem } from "../../todl-build-system/npm/npm-package-build-system.js";
import { HtmlBundleBuildSystem } from "../../todl-build-system/html-bundle/html-bundle-build-system.js";

export interface ProjectSystemComposerOptions
{
    // The real base-model source. Omitted => an empty source (no bases resolve),
    // mirroring GeneratorRegistryContribution's fallback.
    readonly Source?: IPackageSource;
}

// Seeds the three DI-singleton registries with TODL's built-in definitions,
// registers the built-in services + the default presentation baker, and wires the
// ProjectEvents bus + GeneratorScheduler. One method, self-contained (no
// cross-module ordering) — reused by the mural IModule (Task 7) and a headless
// contribution.
export class ProjectSystemComposer
{
    public static Compose(container: IServiceContainer, options: ProjectSystemComposerOptions = {}): void
    {
        const provider = container as unknown as ServiceProvider;

        // 1. Built-in services, resolved lazily via their class tokens.
        container.registerInstance(PresentationBakerKey, new DefaultPresentationBaker());
        container.register(MetaModelProjectFactory, (p) => new MetaModelProjectFactory(p));
        container.register(LibraryProjectFactory, (p) => new LibraryProjectFactory(p));
        container.register(ArchitectureProjectFactory, (p) => new ArchitectureProjectFactory(p));
        container.register(NpmPackageBuildSystem, (p) => new NpmPackageBuildSystem(p.getRequired(PresentationBakerKey)));
        container.register(HtmlBundleBuildSystem, () => new HtmlBundleBuildSystem());

        // 2. The three registries, as singletons.
        const factories = new ProjectFactoryRegistry(provider);
        const buildSystems = new BuildSystemRegistry<TodlBuildContext, ProjectManifest>();
        const generators = new ProjectGeneratorRegistry();
        container.registerInstance(ProjectFactoryRegistryKey, factories);
        container.registerInstance(BuildSystemRegistryKey, buildSystems);
        container.registerInstance(ProjectGeneratorRegistryKey, generators);

        // 3. Seed factory definitions (token-based — resolving never forces construction).
        factories.Register({ TypeId: MetaModelProjectFactory.ProjectType, Factory: MetaModelProjectFactory });
        factories.Register({ TypeId: LibraryProjectFactory.ProjectType, Factory: LibraryProjectFactory });
        factories.Register({ TypeId: ArchitectureProjectFactory.ProjectType, Factory: ArchitectureProjectFactory });

        // 4. Seed build systems.
        buildSystems.RegisterResolved(provider.getRequired(NpmPackageBuildSystem));
        buildSystems.RegisterResolved(provider.getRequired(HtmlBundleBuildSystem));

        // 5. Seed generators FROM the resolved factory instances (each factory owns its
        // own generator set — mirrors GeneratorRegistryContribution.BuildRegistry exactly).
        for (const factory of factories.All())
        {
            if (providesGenerators(factory))
            {
                for (const generator of factory.Generators())
                {
                    generators.Register(factory.typeId, generator);
                }
            }
        }

        // 6. Lifecycle wiring: a Created/Opened/ReferencesChanged event raised on
        // ProjectEventsKey reaches every generator whose Triggers include it.
        const events = new ProjectEvents();
        const scheduler = new GeneratorScheduler(
            generators,
            (event, reason) => ProjectSystemComposer.BuildContext(event, reason, options.Source),
        );
        events.Subscribe((event) => scheduler.Handle(event));
        container.registerInstance(ProjectEventsKey, events);
    }

    private static BuildContext(event: ProjectEvent, reason: GeneratorTrigger, source?: IPackageSource): GeneratorContext
    {
        const effective = source ?? new ProjectSystemComposer.EmptyPackageSource();
        return {
            Project: event.Project,
            Manifest: event.Manifest,
            Model: new ProjectModelProvider(event.Project, event.Manifest, effective),
            Diagnostics: new DiagnosticSink(),
            Reason: reason,
        };
    }

    // A package source with nothing in it — composition falls back to this when no
    // host `Source` is supplied, so a generator's model compile still runs (against
    // zero resolved bases) rather than needing a null check at every call site.
    private static readonly EmptyPackageSource = class EmptyPackageSource implements IPackageSource
    {
        public TryGet(_ref: PackageRef): Promise<SourcedPackage | undefined>
        {
            return Promise.resolve(undefined);
        }
    };
}
