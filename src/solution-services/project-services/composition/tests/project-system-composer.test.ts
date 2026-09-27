import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage, ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { ProjectFactoryRegistryKey } from "../../../solution-manager/engine/host-services.js";
import { ProjectGeneratorRegistryKey } from "../../generators/project-generator-registry.js";
import { ProjectEventsKey, ProjectEventKind } from "../../generators/project-events.js";
import { PresentationBakerKey } from "../../core/presentation-baker.js";
import { DefaultPresentationBaker } from "../../core/default-presentation-baker.js";
import { MetaModelProjectFactory } from "../../meta-model-project/meta-model-project-factory.js";
import { LibraryProjectFactory } from "../../library-project/library-project-factory.js";
import { ArchitectureProjectFactory } from "../../architecture-project/architecture-project-factory.js";
import { BuildSystemRegistryKey } from "../build-system-registry-key.js";
import { NpmPackageBuildSystem } from "../../../todl-build-system/npm/npm-package-build-system.js";
import { HtmlBundleBuildSystem } from "../../../todl-build-system/html-bundle/html-bundle-build-system.js";
import { DtoGenerator } from "../../generators/dto-generator.js";
import { UiPlaceholderGenerator } from "../../generators/ui-placeholder-generator.js";
import { ProjectSystemComposer } from "../project-system-composer.js";
import { NodeProjectSystemComposer } from "../node-project-system-composer.js";
import { FakePresentationBaker } from "../../core/tests/fake-producer-seams.js";
import { TodlProjectBuildManager } from "../../../todl-build-system/todl-project-build-manager.js";
import { FakeStorageProvider, EmptyPackageSource } from "../../../todl-build-system/tests/fakes.js";
import { parseManifest } from "../../../package-manager/manifest.js";
import type { BuildResult } from "../../../build-system-core/build-result.js";
import { PackageStoreKey, type IPackageStore } from "../../../todl-build-system/package-store.js";
import type { SourcedPackage } from "../../../todl-build-system/package-source.js";
import type { PackageRef } from "../../../../publish/publish.js";
import { SolutionManagerService } from "../../../solution-manager/engine/solution-manager-service.js";

const ARCH_MODEL = "namespace acme { concept Widget { label : string?; } }";
const NpmPackageId = "npm-package";
const HtmlBundleId = "html-bundle";
const LIBRARY_WITH_ICON = 'namespace acme { concept Widget { label : string?; annotate icon { path = "visuals/w.svg"; } } }';
const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>';
// A consumer architecture's OWN model: extends the bound meta-model's concept by
// qualified name (rather than redeclaring `acme.Widget` itself), so a successful
// compile proves the bound base actually resolved and merged in.
const CONSUMER_MODEL = "namespace consumer { concept Gadget : acme.Widget { } }";

// A host package store that records every ref the generators' base resolution asks
// for and holds nothing — so a bound base is REQUESTED through it and then misses.
class RecordingPackageStore implements IPackageStore
{
    public readonly Storage = new FakeStorage();
    public readonly Requested: PackageRef[] = [];

    public TryGet(ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        this.Requested.push(ref);
        return Promise.resolve(undefined);
    }
}

class ComposerFixtures
{
    public static readonly BoundMetaModelId = "acme-meta";
    public static readonly BoundMetaModelVersion = "1.0.0";

    public static ArchManifest(): ProjectManifest
    {
        return {
            type: ProjectType.Architecture,
            name: "Test Architecture",
            version: 1,
            id: "test-architecture",
            packageVersion: "0.1.0",
        };
    }

    // The architecture manifest bound to a meta-model the test's store does not hold.
    public static BoundArchManifest(): ProjectManifest
    {
        return {
            ...ComposerFixtures.ArchManifest(),
            metaModels: [{ id: ComposerFixtures.BoundMetaModelId, version: ComposerFixtures.BoundMetaModelVersion }],
        };
    }

    // A library declaring a real `@icon` resource, so the npm-package pipeline's bake
    // gate opens and the build reaches the presentation baker.
    public static async LibraryProjectWithIcon(): Promise<FakeStorage>
    {
        const storage = new FakeStorage();
        await storage.WriteText("project.plexus", JSON.stringify({ type: "library", name: "widgets", version: 1, id: "widgets", packageVersion: "0.1.0" }));
        await storage.WriteText("model.todl", LIBRARY_WITH_ICON);
        await storage.WriteText("visuals/w.svg", ICON_SVG);
        return storage;
    }

    // Builds `project` with the COMPOSED npm-package build system (resolved from the
    // composed BuildSystemRegistryKey registry, not hand-constructed).
    public static async BuildComposed(provider: ServiceProvider, project: FakeStorage): Promise<{ result: BuildResult; output: FakeStorageProvider }>
    {
        const manifest = parseManifest(await project.ReadText("project.plexus"));
        const output = new FakeStorageProvider();
        const manager = new TodlProjectBuildManager(provider.getRequired(BuildSystemRegistryKey), output);
        const { Result: result } = await manager.Build({ Project: project, Manifest: manifest, BuildSystemId: NpmPackageId, Source: new EmptyPackageSource() });
        return { result, output };
    }

    public static async ArchProject(): Promise<FakeStorage>
    {
        const storage = new FakeStorage();
        await storage.WriteText("model.todl", ARCH_MODEL);
        return storage;
    }

    // An open, unpublished meta-model member's storage: project.plexus (id/version
    // matching BoundArchManifest's binding) + the .todl declaring `acme.Widget` — the
    // live sibling a consumer's metaModels binding resolves against when a
    // SolutionManagerService is registered (instead of the published store).
    public static async LiveMetaModelStorage(): Promise<FakeStorage>
    {
        const storage = new FakeStorage();
        const manifest: ProjectManifest = {
            type: ProjectType.MetaModel,
            name: "Acme Meta",
            version: 1,
            id: ComposerFixtures.BoundMetaModelId,
            packageVersion: ComposerFixtures.BoundMetaModelVersion,
        };
        await storage.WriteText("project.plexus", JSON.stringify(manifest));
        await storage.WriteText("model.todl", ARCH_MODEL);
        return storage;
    }

    public static async ConsumerProject(): Promise<FakeStorage>
    {
        const storage = new FakeStorage();
        await storage.WriteText("model.todl", CONSUMER_MODEL);
        return storage;
    }

    // A fake SolutionManagerService exposing ActiveSolution.Members with { Ref, Storage }
    // per member — the only surface SolutionBaseResolver reads (see
    // solution-base-resolver.test.ts's identical fixture shape).
    public static FakeSolutionManager(members: readonly { id: string; type: ProjectType; storage: FakeStorage }[]): SolutionManagerService
    {
        return {
            ActiveSolution: {
                Members: members.map((m) => ({ Ref: { path: m.id, type: m.type }, Storage: m.storage })),
            },
        } as unknown as SolutionManagerService;
    }
}

describe("ProjectSystemComposer", () =>
{
    test("Compose seeds the factory registry with all three built-in project types", () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);

        const factories = provider.getRequired(ProjectFactoryRegistryKey);
        assert.ok(factories.factoryFor(MetaModelProjectFactory.ProjectType) instanceof MetaModelProjectFactory);
        assert.ok(factories.factoryFor(LibraryProjectFactory.ProjectType) instanceof LibraryProjectFactory);
        assert.ok(factories.factoryFor(ArchitectureProjectFactory.ProjectType) instanceof ArchitectureProjectFactory);
    });

    test("Compose (browser-safe core) seeds npm-package but NOT the node-bound html-bundle", () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);

        const buildSystems = provider.getRequired(BuildSystemRegistryKey);
        assert.ok(buildSystems.Get(NpmPackageId) instanceof NpmPackageBuildSystem);
        assert.equal(buildSystems.Get(HtmlBundleId), undefined);
    });

    test("Compose seeds the generator registry from the architecture factory's own generators, exactly once each", () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);

        const generators = provider.getRequired(ProjectGeneratorRegistryKey);
        const forArch = generators.For(ArchitectureProjectFactory.ProjectType);

        assert.equal(forArch.length, 2);
        assert.equal(forArch.filter((g) => g instanceof DtoGenerator).length, 1);
        assert.equal(forArch.filter((g) => g instanceof UiPlaceholderGenerator).length, 1);
    });

    test("Compose registers the default presentation baker under PresentationBakerKey", () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);

        const baker = provider.getRequired(PresentationBakerKey);
        assert.ok(baker instanceof DefaultPresentationBaker);
    });

    test("a baker registered under PresentationBakerKey AFTER composition is the one the composed build uses", async () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);
        // Force the build system (and its registry seeding) to exist before the override,
        // exactly as a host's later module would find it.
        assert.ok(provider.getRequired(BuildSystemRegistryKey).Get(NpmPackageId) instanceof NpmPackageBuildSystem);

        const override = new FakePresentationBaker();
        provider.registerInstance(PresentationBakerKey, override);

        const { result, output } = await ComposerFixtures.BuildComposed(provider, await ComposerFixtures.LibraryProjectWithIcon());

        assert.equal(result.Ok, true, JSON.stringify(result.Diagnostics));
        assert.equal(override.calls.length, 1, "the override baked the build");
        assert.equal(override.calls[0]?.options.dictName, "LibraryPresentation");
        assert.equal(await output.Output.Exists("presentation/presentation.compiled.json"), false, "the default baker did not run");
    });

    test("with no override, the composed build bakes through the TODL default baker", async () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);

        const { result, output } = await ComposerFixtures.BuildComposed(provider, await ComposerFixtures.LibraryProjectWithIcon());

        assert.equal(result.Ok, true, JSON.stringify(result.Diagnostics));
        assert.equal(await output.Output.Exists("presentation/presentation.compiled.json"), true);
        const index = JSON.parse(await output.Output.ReadText("presentation/icon-index.json")) as Record<string, string>;
        assert.equal(index["Widget"], "mm_icon_w");
    });

    test("raising a Created event runs the architecture generators end to end", async () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);

        const project = await ComposerFixtures.ArchProject();
        const events = provider.getRequired(ProjectEventsKey);

        await events.Raise({
            Kind: ProjectEventKind.Created,
            ProjectType: ArchitectureProjectFactory.ProjectType,
            Project: project,
            Manifest: ComposerFixtures.ArchManifest(),
        });

        assert.ok(await project.Exists("generated/app.mu"), "UiPlaceholderGenerator should have written generated/app.mu");
        assert.ok(await project.Exists("generated/model.ts"), "DtoGenerator should have written generated/model.ts");
    });

    test("generators resolve bases through a PackageStoreKey store registered AFTER composition", async () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);
        const store = new RecordingPackageStore();
        provider.registerInstance(PackageStoreKey, store);

        const project = await ComposerFixtures.ArchProject();
        await provider.getRequired(ProjectEventsKey).Raise({
            Kind: ProjectEventKind.Created,
            ProjectType: ArchitectureProjectFactory.ProjectType,
            Project: project,
            Manifest: ComposerFixtures.BoundArchManifest(),
        });

        // One lookup per generator (each gets a fresh model provider), all for the bound base.
        const bound = `${ComposerFixtures.BoundMetaModelId}@${ComposerFixtures.BoundMetaModelVersion}`;
        assert.deepEqual(store.Requested.map((r) => `${r.id}@${r.version}`), [bound, bound]);
        // The bound base missed in the host store, so the model did not compile and
        // nothing was generated — the host store (not the empty fallback) was the source.
        assert.equal(await project.Exists("generated/model.ts"), false);
        assert.equal(await project.Exists("generated/app.mu"), false);
    });

    test("an explicit composer Source wins over a registered PackageStoreKey store", async () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider, { Source: new EmptyPackageSource() });
        const store = new RecordingPackageStore();
        provider.registerInstance(PackageStoreKey, store);

        await provider.getRequired(ProjectEventsKey).Raise({
            Kind: ProjectEventKind.Created,
            ProjectType: ArchitectureProjectFactory.ProjectType,
            Project: await ComposerFixtures.ArchProject(),
            Manifest: ComposerFixtures.BoundArchManifest(),
        });

        assert.equal(store.Requested.length, 0);
    });

    test("generators resolve bases through SolutionBaseResolver when a SolutionManagerService is registered", async () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);
        provider.registerInstance(SolutionManagerService.Key, ComposerFixtures.FakeSolutionManager([
            { id: ComposerFixtures.BoundMetaModelId, type: ProjectType.MetaModel, storage: await ComposerFixtures.LiveMetaModelStorage() },
        ]));
        const store = new RecordingPackageStore();
        provider.registerInstance(PackageStoreKey, store);

        const project = await ComposerFixtures.ConsumerProject();
        await provider.getRequired(ProjectEventsKey).Raise({
            Kind: ProjectEventKind.Created,
            ProjectType: ArchitectureProjectFactory.ProjectType,
            Project: project,
            Manifest: ComposerFixtures.BoundArchManifest(),
        });

        // The bound base resolved from the LIVE open member, never asking the published
        // store — an unresolved bound base is a hard compile error (see the
        // PackageStoreKey-only test above), so the generated output only exists because
        // the live sibling resolved.
        assert.equal(store.Requested.length, 0, "the live sibling resolved before the published store was ever asked");
        assert.ok(await project.Exists("generated/model.ts"), "DtoGenerator ran against a model that resolved the live base");
        assert.ok(await project.Exists("generated/app.mu"), "UiPlaceholderGenerator ran against a model that resolved the live base");
        const dto = await project.ReadText("generated/model.ts");
        assert.ok(dto.includes("Widget"), "the generated DTO reflects the live base's own concept");
    });

    test("with no SolutionManagerService the composer falls back to PackageStoreKey/empty (unchanged)", async () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);

        const project = await ComposerFixtures.ArchProject();
        await provider.getRequired(ProjectEventsKey).Raise({
            Kind: ProjectEventKind.Created,
            ProjectType: ArchitectureProjectFactory.ProjectType,
            Project: project,
            Manifest: ComposerFixtures.ArchManifest(),
        });

        assert.ok(await project.Exists("generated/app.mu"), "UiPlaceholderGenerator should still run with no SolutionManagerService registered");
        assert.ok(await project.Exists("generated/model.ts"), "DtoGenerator should still run with no SolutionManagerService registered");
    });
});

describe("NodeProjectSystemComposer", () =>
{
    test("Compose seeds the core AND layers html-bundle on top", () =>
    {
        const provider = new ServiceProvider();
        NodeProjectSystemComposer.Compose(provider);

        const buildSystems = provider.getRequired(BuildSystemRegistryKey);
        assert.ok(buildSystems.Get(NpmPackageId) instanceof NpmPackageBuildSystem);
        assert.ok(buildSystems.Get(HtmlBundleId) instanceof HtmlBundleBuildSystem);

        const factories = provider.getRequired(ProjectFactoryRegistryKey);
        assert.ok(factories.factoryFor(ArchitectureProjectFactory.ProjectType) instanceof ArchitectureProjectFactory);
        assert.ok(provider.getRequired(PresentationBakerKey) instanceof DefaultPresentationBaker);
    });

    test("Compose reuses the core seeding exactly once (no duplicated generators)", () =>
    {
        const provider = new ServiceProvider();
        NodeProjectSystemComposer.Compose(provider);

        const forArch = provider.getRequired(ProjectGeneratorRegistryKey).For(ArchitectureProjectFactory.ProjectType);
        assert.equal(forArch.length, 2);
    });
});
