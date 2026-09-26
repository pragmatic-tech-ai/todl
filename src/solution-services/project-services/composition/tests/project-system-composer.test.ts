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

const ARCH_MODEL = "namespace acme { concept Widget { label : string?; } }";
const NpmPackageId = "npm-package";
const HtmlBundleId = "html-bundle";
const LIBRARY_WITH_ICON = 'namespace acme { concept Widget { label : string?; annotate icon { path = "visuals/w.svg"; } } }';
const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>';

class ComposerFixtures
{
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
