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

const ARCH_MODEL = "namespace acme { concept Widget { label : string?; } }";
const NpmPackageId = "npm-package";
const HtmlBundleId = "html-bundle";

function archManifest(): ProjectManifest
{
    return {
        type: ProjectType.Architecture,
        name: "Test Architecture",
        version: 1,
        id: "test-architecture",
        packageVersion: "0.1.0",
    };
}

async function archProject(): Promise<FakeStorage>
{
    const storage = new FakeStorage();
    await storage.WriteText("model.todl", ARCH_MODEL);
    return storage;
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

    test("Compose seeds the build-system registry with npm-package + html-bundle", () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);

        const buildSystems = provider.getRequired(BuildSystemRegistryKey);
        assert.ok(buildSystems.Get(NpmPackageId) instanceof NpmPackageBuildSystem);
        assert.ok(buildSystems.Get(HtmlBundleId) instanceof HtmlBundleBuildSystem);
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

    test("raising a Created event runs the architecture generators end to end", async () =>
    {
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);

        const project = await archProject();
        const events = provider.getRequired(ProjectEventsKey);

        await events.Raise({
            Kind: ProjectEventKind.Created,
            ProjectType: ArchitectureProjectFactory.ProjectType,
            Project: project,
            Manifest: archManifest(),
        });

        assert.ok(await project.Exists("generated/app.mu"), "UiPlaceholderGenerator should have written generated/app.mu");
        assert.ok(await project.Exists("generated/model.ts"), "DtoGenerator should have written generated/model.ts");
    });
});
