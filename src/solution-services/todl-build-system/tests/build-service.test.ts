import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    FakeStorage,
    ServiceProvider,
    type IPromptService,
    type IServiceProvider,
} from '@pragmatic-tech-ai/todl-runtime';
import {
    ArtifactKey,
    BuildSystemRegistry,
    StaticBuildFlavor,
    Severity,
    type BuildFlavor,
    type BuildDiagnostic,
    type IBuildAction,
    type IBuildSystem,
} from '../../build-system-core/index.js';
import { type TodlBuildContext } from '../todl-build-context.js';
import { type ProjectManifest } from '../../package-manager/manifest.js';
import { PackageStoreKey, StoragePackageStore } from '../package-store.js';
import { BuildSystemRegistryKey } from '../../project-services/composition/build-system-registry-key.js';
import { SolutionManagerService } from '../../solution-manager/engine/solution-manager-service.js';
import type { IStorageProviderRegistry, IProjectFactoryRegistry } from '../../solution-manager/engine/host-services.js';
import { LocalNpmRegistry } from '../../package-manager/registries/npm/local-npm-registry.js';
import { type IPackageRegistry } from '../../package-manager/engine/package-registry.js';
import { FakeRegistry } from '../../package-manager/engine/tests/fakes.js';
import { PROJECT_MANIFEST_FILENAME } from '../../project-services/core/project-factory.js';
import { BuildService } from '../build-service.js';
import { BuildStorageProviderKey } from '../build-storage-provider-key.js';
import type { IBuildStorageProvider } from '../../build-system-core/build-storage-provider.js';

// Records the PublishRegistry the manager's TodlBuildContext carried — the single
// action in the fake npm-package system's npm-publish flavor, standing in for the
// real resolve/compile/emit/publish pipeline so this test stays light (no real
// compile). Reports no diagnostics, so every build it runs succeeds.
class RecordingPublishAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = 'recording-publish';

    public readonly Name = RecordingPublishAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];
    public SeenRegistry: IPackageRegistry | undefined;

    public Execute(ctx: TodlBuildContext): Promise<void>
    {
        this.SeenRegistry = ctx.PublishRegistry;
        return Promise.resolve();
    }
}

// Stands in for an emit action: writes a file into the build sandbox, which the
// manager copies into the opened output storage on success.
class SandboxWritingAction implements IBuildAction<TodlBuildContext>
{
    public static readonly OutputFile = 'out.txt';
    private static readonly ActionName = 'sandbox-writing';
    private static readonly Content = 'built';

    public readonly Name = SandboxWritingAction.ActionName;
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    public Execute(ctx: TodlBuildContext): Promise<void>
    {
        return ctx.Sandbox.WriteText(SandboxWritingAction.OutputFile, SandboxWritingAction.Content);
    }
}

// The minimal fake IBuildSystem the test registers under BuildSystemRegistryKey: id
// 'npm-package' (AppliesTo always true), a 'npm-publish' flavor wrapping the publish
// action (BuildService.Publish's flavor) plus a second, non-publish 'npm-build' flavor
// wrapping a plain build action (BuildService.Build's target), each a single action. No
// Consumes/Produces, so BuildSystemRegistry.Register's consume-before-produce validation
// passes trivially. Ids are public so the test can pass them straight to BuildService.
class FakeNpmPackageBuildSystem implements IBuildSystem<TodlBuildContext, ProjectManifest>
{
    public static readonly SystemId = 'npm-package';
    public static readonly PublishFlavorId = 'npm-publish';
    public static readonly BuildFlavorId = 'npm-build';
    private static readonly PublishFlavorDisplayName = 'Publish';
    private static readonly BuildFlavorDisplayName = 'Build';
    private static readonly OutputName = 'dist';
    private static readonly SystemDisplayName = 'Fake npm package';

    public readonly Id = FakeNpmPackageBuildSystem.SystemId;
    public readonly DisplayName = FakeNpmPackageBuildSystem.SystemDisplayName;
    private readonly flavors: readonly BuildFlavor<TodlBuildContext>[];

    constructor(publishAction: IBuildAction<TodlBuildContext>, buildAction: IBuildAction<TodlBuildContext> = publishAction)
    {
        this.flavors = [
            new StaticBuildFlavor<TodlBuildContext>(
                FakeNpmPackageBuildSystem.PublishFlavorId,
                FakeNpmPackageBuildSystem.PublishFlavorDisplayName,
                FakeNpmPackageBuildSystem.OutputName,
                [publishAction],
            ),
            new StaticBuildFlavor<TodlBuildContext>(
                FakeNpmPackageBuildSystem.BuildFlavorId,
                FakeNpmPackageBuildSystem.BuildFlavorDisplayName,
                FakeNpmPackageBuildSystem.OutputName,
                [buildAction],
            ),
        ];
    }

    public AppliesTo(_project: ProjectManifest): boolean
    {
        return true;
    }

    public Flavors(): readonly BuildFlavor<TodlBuildContext>[]
    {
        return this.flavors;
    }
}

// A prompt service SolutionManagerService's ctor requires but this fixture never
// drives (no dirty-solution / Save-As flow is exercised) — every method rejects.
class StubPromptService implements IPromptService
{
    private static readonly NotExercisedMessage = 'StubPromptService: not exercised by this fixture';

    public Ask<R>(): Promise<R>
    {
        return Promise.reject(new Error(StubPromptService.NotExercisedMessage));
    }
    public Confirm(): Promise<boolean>
    {
        return Promise.reject(new Error(StubPromptService.NotExercisedMessage));
    }
    public PickFolder(): Promise<string | undefined>
    {
        return Promise.reject(new Error(StubPromptService.NotExercisedMessage));
    }
    public PickFile(): Promise<string | undefined>
    {
        return Promise.reject(new Error(StubPromptService.NotExercisedMessage));
    }
    public PromptText(): Promise<string | undefined>
    {
        return Promise.reject(new Error(StubPromptService.NotExercisedMessage));
    }
    public Choose<T>(): Promise<T | undefined>
    {
        return Promise.reject(new Error(StubPromptService.NotExercisedMessage));
    }
}

// Test fixture: builds the minimal object graph BuildService needs — a fake
// BuildSystemRegistry (light pipeline, no real compile), a package store over a
// FakeStorage, a bare SolutionManagerService, and the project storage carrying a
// parseable project.plexus manifest.
class TestFixture
{
    private static readonly PackageId = 'widgets';
    private static readonly PackageVersion = '1.2.3';
    private static readonly PackageSourceNotExercisedMessage = 'PackageSource: not exercised by this fixture';
    public static readonly ProvidedOutputPath = '/disk/html-bundle';

    public static async MakeProject(): Promise<FakeStorage>
    {
        const storage = new FakeStorage();
        await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({
            type: 'library',
            name: TestFixture.PackageId,
            version: 1,
            id: TestFixture.PackageId,
            packageVersion: TestFixture.PackageVersion,
        }));
        return storage;
    }

    public static get ExpectedId(): string
    {
        return TestFixture.PackageId;
    }

    public static get ExpectedVersion(): string
    {
        return TestFixture.PackageVersion;
    }

    // A bare SolutionManagerService through its real constructor, with minimal fakes
    // for the host seams it requires but this fixture never drives — just enough to
    // hold and hand back a PublishRegistry.
    public static MakeSolutionManagerService(): SolutionManagerService
    {
        const storages: IStorageProviderRegistry = {
            CreateStorage: (folder: string) => new FakeStorage(folder),
        };
        const factories: IProjectFactoryRegistry = {
            factoryFor: () => undefined,
            All: () => [],
        };
        const prompts = new StubPromptService();
        const packages = {
            resolve: () => Promise.reject(new Error(TestFixture.PackageSourceNotExercisedMessage)),
        };
        const provider = {
            get: () => undefined,
            getRequired: (token: unknown) =>
            {
                if (token === SolutionManagerService.StorageRegistryKey) return storages;
                if (token === SolutionManagerService.ProjectFactoryRegistryKey) return factories;
                if (token === SolutionManagerService.PromptServiceKey) return prompts;
                if (token === SolutionManagerService.PackageSourceKey) return packages;
                throw new Error(`unexpected service key: ${String(token)}`);
            },
            has: () => true,
        } as unknown as IServiceProvider;
        return new SolutionManagerService(provider);
    }

    // Builds the provider BuildService resolves against: the fake registry (wrapping
    // `publishAction` under 'npm-publish' and `buildAction` under 'npm-build'), a fresh
    // package store, and `solutionManager`. `buildAction` defaults to `publishAction` for
    // callers that only exercise Publish.
    public static MakeProvider(
        publishAction: IBuildAction<TodlBuildContext>,
        solutionManager: SolutionManagerService,
        buildAction: IBuildAction<TodlBuildContext> = publishAction,
        storageProvider?: IBuildStorageProvider,
    ): IServiceProvider
    {
        const buildSystems = new BuildSystemRegistry<TodlBuildContext, ProjectManifest>();
        buildSystems.Register(new FakeNpmPackageBuildSystem(publishAction, buildAction));

        const provider = new ServiceProvider();
        provider.registerInstance(PackageStoreKey, new StoragePackageStore(new FakeStorage()));
        provider.registerInstance(BuildSystemRegistryKey, buildSystems);
        provider.registerInstance(SolutionManagerService.Key, solutionManager);
        if (storageProvider !== undefined) provider.registerInstance(BuildStorageProviderKey, storageProvider);
        return provider;
    }
}

describe('BuildService.FormatErrors', () =>
{
    test('joins only Severity.Error messages with "; "', () =>
    {
        const diagnostics: readonly BuildDiagnostic[] = [
            { severity: Severity.Error, message: 'first error' },
            { severity: Severity.Warning, message: 'a warning, not joined' },
            { severity: Severity.Error, message: 'second error' },
        ];

        assert.equal(BuildService.FormatErrors(diagnostics), 'first error; second error');
    });
});

describe('BuildService.Publish', () =>
{
    test('routes to SolutionManagerService.PublishRegistry when it is set', async () =>
    {
        const action = new RecordingPublishAction();
        const solutionManager = TestFixture.MakeSolutionManagerService();
        const registry = new FakeRegistry();
        solutionManager.PublishRegistry = registry;
        const provider = TestFixture.MakeProvider(action, solutionManager);
        const service = new BuildService(provider);
        const project = await TestFixture.MakeProject();

        const outcome = await service.Publish(project);

        assert.equal(action.SeenRegistry, registry);
        assert.deepEqual(outcome, {
            Ok: true,
            Diagnostics: [],
            Id: TestFixture.ExpectedId,
            Version: TestFixture.ExpectedVersion,
        });
    });

    test('falls back to a LocalNpmRegistry when PublishRegistry is unset', async () =>
    {
        const action = new RecordingPublishAction();
        const solutionManager = TestFixture.MakeSolutionManagerService();
        // PublishRegistry left undefined — mirrors a solution with no registry connection configured.
        const provider = TestFixture.MakeProvider(action, solutionManager);
        const service = new BuildService(provider);
        const project = await TestFixture.MakeProject();

        const outcome = await service.Publish(project);

        assert.ok(action.SeenRegistry instanceof LocalNpmRegistry);
        assert.equal(outcome.Ok, true);
    });
});

describe('BuildService.Build', () =>
{
    test('builds a non-publish flavor and returns a successful ProjectBuildOutput', async () =>
    {
        const publishAction = new RecordingPublishAction();
        const buildAction = new RecordingPublishAction();
        const solutionManager = TestFixture.MakeSolutionManagerService();
        const provider = TestFixture.MakeProvider(publishAction, solutionManager, buildAction);
        const service = new BuildService(provider);
        const project = await TestFixture.MakeProject();

        const output = await service.Build(project, FakeNpmPackageBuildSystem.SystemId, FakeNpmPackageBuildSystem.BuildFlavorId);

        assert.equal(output.Result.Ok, true);
    });

    test('uses the registered BuildStorageProviderKey output provider', async () =>
    {
        const output = new FakeStorage();
        const storageProvider: IBuildStorageProvider =
        {
            CreateSandbox: () => Promise.resolve(new FakeStorage()),
            DeleteSandbox: () => Promise.resolve(),
            OpenOutput: () => Promise.resolve({ Storage: output, Path: TestFixture.ProvidedOutputPath }),
        };
        const publishAction = new RecordingPublishAction();
        const provider = TestFixture.MakeProvider(
            publishAction, TestFixture.MakeSolutionManagerService(), new SandboxWritingAction(), storageProvider);
        const service = new BuildService(provider);
        const project = await TestFixture.MakeProject();

        const result = await service.Build(project, FakeNpmPackageBuildSystem.SystemId, FakeNpmPackageBuildSystem.BuildFlavorId);

        assert.equal(result.Result.OutputPath, TestFixture.ProvidedOutputPath);
        assert.equal(await output.Exists(SandboxWritingAction.OutputFile), true);
    });

    test('falls back to in-memory output when no provider is registered', async () =>
    {
        const publishAction = new RecordingPublishAction();
        const provider = TestFixture.MakeProvider(publishAction, TestFixture.MakeSolutionManagerService(), new SandboxWritingAction());
        const service = new BuildService(provider);
        const project = await TestFixture.MakeProject();

        const result = await service.Build(project, FakeNpmPackageBuildSystem.SystemId, FakeNpmPackageBuildSystem.BuildFlavorId);

        assert.equal(result.Result.Ok, true);
        assert.notEqual(result.Result.OutputPath, TestFixture.ProvidedOutputPath);
    });
});
