/**
 * The single unified seeder for the three project-system DI registries + the
 * default presentation baker + the ProjectEvents/GeneratorScheduler lifecycle. It is
 * the ONE owner of the project-factory registry under ProjectFactoryRegistryKey
 * (`solution-services-module.mu` no longer registers factories) and of the lifecycle
 * scheduler wiring (it superseded the retired `GeneratorRegistryContribution`). The
 * remaining old unit (`todl-build-system-module.mu`) stays in place for deferred
 * devUI/Plexus consumers. `ProjectSystemComposer`
 * is a new, self-contained composer, reused by a mural module (Task 7) and a
 * headless contribution, that stands up TODL's built-in factories/build-systems/
 * generators into a FRESH container in one call.
 *
 * BROWSER-SAFE: this core composer's import graph reaches NO node builtin and NO
 * esbuild, so it (and `TodlProjectSystemModule`) ships on the main barrel and loads in
 * a renderer bundle. The one node-bound build system — html-bundle (esbuild +
 * node fs) — is layered on by `NodeProjectSystemComposer` (node-only `./project-system`
 * subpath), which calls this composer first and then registers it. The guard test
 * `tests/browser-safe-composition.test.ts` bundles this graph for the browser platform.
 */

import { type IServiceContainer, type IServiceProvider, ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
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
import { ProviderPresentationBaker } from "../core/provider-presentation-baker.js";
import { providesGenerators } from "../core/project-factory.js";
import type { IPackageSource, SourcedPackage } from "../../todl-build-system/package-source.js";
import { PackageStoreKey } from "../../todl-build-system/package-store.js";
import type { PackageRef } from "../../../publish/publish.js";
import { SolutionManagerService } from "../../solution-manager/engine/solution-manager-service.js";
import { SolutionBaseResolver } from "../../solution-manager/engine/solution-base-resolver.js";
// Built-in factories / build systems.
import { MetaModelProjectFactory } from "../meta-model-project/meta-model-project-factory.js";
import { LibraryProjectFactory } from "../library-project/library-project-factory.js";
import { ArchitectureProjectFactory } from "../architecture-project/architecture-project-factory.js";
import { NpmPackageBuildSystem } from "../../todl-build-system/npm/npm-package-build-system.js";

export interface ProjectSystemComposerOptions
{
    // The real base-model source. Omitted => the host's IPackageStore (PackageStoreKey),
    // resolved lazily at EVENT time; neither => an empty source (no bases resolve).
    readonly Source?: IPackageSource;
}

// Seeds the three DI-singleton registries with TODL's browser-safe built-in definitions
// (npm-package build system incl. its publish flavor; NOT html-bundle — see header),
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
        // The build bakes through PresentationBakerKey resolved at BAKE time (not here), so
        // a host that re-registers the key after composition still reaches the build.
        container.register(NpmPackageBuildSystem, (p) => new NpmPackageBuildSystem(new ProviderPresentationBaker(p)));
        // A lazy container singleton (default register() lifetime): NOT constructed here —
        // only on the first ResolveSource call that finds a SolutionManagerService
        // registered. That first resolve is also the ONLY construction for the container's
        // lifetime (ServiceProvider caches singletons at the owner), so the resolver's
        // Task-3 per-member cache survives across every subsequent event and its
        // ActiveSolution subscription (subscribeToManager, in its constructor) is created
        // exactly once — never a fresh, leaked subscription per event. See ResolveSource.
        container.register(SolutionBaseResolver.Key, (p) => new SolutionBaseResolver(p));

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

        // 5. Seed generators FROM the resolved factory instances (each factory owns its
        // own generator set; each is registered exactly once).
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
            (event, reason) => ProjectSystemComposer.BuildContext(event, reason, ProjectSystemComposer.ResolveSource(provider, options.Source)),
        );
        events.Subscribe((event) => scheduler.Handle(event));
        container.registerInstance(ProjectEventsKey, events);
    }

    // Which branch to resolve through is picked at EVENT time (not composition time) so
    // a host that registers its package store, or its SolutionManagerService, after
    // composition is still reached. An explicit composer Source always wins; otherwise,
    // an open solution resolves a bound base through the ONE shared SolutionBaseResolver
    // singleton (registered lazily in Compose, under SolutionBaseResolver.Key — resolving
    // it here, rather than constructing a fresh instance per event, is what makes its
    // Task-3 cache/graph and its single ActiveSolution subscription survive across every
    // event); with neither, the published store (PackageStoreKey) — Plexus registers
    // PlexusPackageStore under it in a later module — or, failing that, the empty source.
    private static ResolveSource(provider: IServiceProvider, explicit?: IPackageSource): IPackageSource
    {
        if (explicit !== undefined) return explicit;
        if (provider.get(SolutionManagerService.Key) !== undefined) return provider.getRequired(SolutionBaseResolver.Key);
        return provider.get(PackageStoreKey) ?? new ProjectSystemComposer.EmptyPackageSource();
    }

    private static BuildContext(event: ProjectEvent, reason: GeneratorTrigger, source: IPackageSource): GeneratorContext
    {
        return {
            Project: event.Project,
            Manifest: event.Manifest,
            Model: new ProjectModelProvider(event.Project, event.Manifest, source),
            Diagnostics: new DiagnosticSink(),
            Reason: reason,
        };
    }

    // A package source with nothing in it — composition falls back to this when no
    // host `Source` is supplied and no PackageStoreKey is registered, so a generator's model compile still runs (against
    // zero resolved bases) rather than needing a null check at every call site.
    private static readonly EmptyPackageSource = class EmptyPackageSource implements IPackageSource
    {
        public TryGet(_ref: PackageRef): Promise<SourcedPackage | undefined>
        {
            return Promise.resolve(undefined);
        }
    };
}
