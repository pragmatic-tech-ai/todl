import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime';
import { type IStorage } from '@pragmatic-tech-ai/todl-runtime';
import { Severity, type BuildDiagnostic } from '../build-system-core/index.js';
import { type IBuildProgress } from '../build-system-core/index.js';
import { type ProjectBuildOutput } from '../build-system-core/index.js';
import { BuildSystemRegistryKey } from '../project-services/composition/build-system-registry-key.js';
import { PackageStoreKey } from './package-store.js';
import { SolutionManagerService } from '../solution-manager/engine/solution-manager-service.js';
import { LocalNpmRegistry } from '../package-manager/registries/npm/local-npm-registry.js';
import { parseManifest } from '../package-manager/manifest.js';
import { PROJECT_MANIFEST_FILENAME } from '../project-services/core/project-factory.js';
import { TodlProjectBuildManager } from './todl-project-build-manager.js';
import { InMemoryBuildStorage } from './in-memory-build-storage.js';
import { ScopeFlatteningStorage } from './scope-flattening-storage.js';

export interface PublishOutcome
{
    readonly Ok: boolean;
    readonly Diagnostics: readonly BuildDiagnostic[];
    readonly Id: string;
    readonly Version: string;
}

// The engine home for build/publish orchestration (was plexus-core's
// PackagePublisher). The UI calls these down and tracks progress via the
// supplied IBuildProgress; the engine does the work and never calls up.
export class BuildService
{
    public static readonly Key = new ServiceKey<BuildService>('BuildService');
    private static readonly NpmPackageBuildSystemId = 'npm-package';
    private static readonly PublishFlavorId = 'npm-publish';
    private static readonly DiagnosticSeparator = '; ';
    private static readonly UnknownId = '(unknown)';
    private static readonly NoVersion = '';

    constructor(private readonly provider: IServiceProvider)
    {
    }

    public async Build(project: IStorage, buildSystemId: string, flavorId?: string, progress?: IBuildProgress): Promise<ProjectBuildOutput>
    {
        const store = this.provider.getRequired(PackageStoreKey);
        const manifest = parseManifest(await project.ReadText(PROJECT_MANIFEST_FILENAME));
        const buildSystems = this.provider.getRequired(BuildSystemRegistryKey);
        const manager = new TodlProjectBuildManager(buildSystems, new InMemoryBuildStorage());
        return manager.Build({
            Project: project,
            Manifest: manifest,
            BuildSystemId: buildSystemId,
            Source: store,
            ...(flavorId !== undefined ? { BuildFlavorId: flavorId } : {}),
            ...(progress !== undefined ? { Progress: progress } : {}),
        });
    }

    public async Publish(project: IStorage, progress?: IBuildProgress): Promise<PublishOutcome>
    {
        const store = this.provider.getRequired(PackageStoreKey);
        const registry = this.provider.getRequired(SolutionManagerService.Key).PublishRegistry
            ?? new LocalNpmRegistry(new ScopeFlatteningStorage(store.Storage));
        const manifest = parseManifest(await project.ReadText(PROJECT_MANIFEST_FILENAME));
        const buildSystems = this.provider.getRequired(BuildSystemRegistryKey);
        const manager = new TodlProjectBuildManager(buildSystems, new InMemoryBuildStorage());
        const { Result: result } = await manager.Build({
            Project: project,
            Manifest: manifest,
            BuildSystemId: BuildService.NpmPackageBuildSystemId,
            BuildFlavorId: BuildService.PublishFlavorId,
            Source: store,
            PublishRegistry: registry,
            ...(progress !== undefined ? { Progress: progress } : {}),
        });
        return {
            Ok: result.Ok,
            Diagnostics: result.Diagnostics,
            Id: manifest.id ?? manifest.name ?? BuildService.UnknownId,
            Version: manifest.packageVersion ?? BuildService.NoVersion,
        };
    }

    public static FormatErrors(diagnostics: readonly BuildDiagnostic[]): string
    {
        return diagnostics
            .filter(d => d.severity === Severity.Error)
            .map(d => d.message)
            .join(BuildService.DiagnosticSeparator);
    }
}
