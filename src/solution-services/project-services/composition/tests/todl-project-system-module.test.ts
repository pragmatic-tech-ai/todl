import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider, CompositionRoot } from "@pragmatic-tech-ai/todl-runtime";
import { ProjectFactoryRegistryKey } from "../../../solution-manager/engine/host-services.js";
import { PresentationBakerKey } from "../../core/presentation-baker.js";
import { DefaultPresentationBaker } from "../../core/default-presentation-baker.js";
import { MetaModelProjectFactory } from "../../meta-model-project/meta-model-project-factory.js";
import { BuildSystemRegistryKey } from "../build-system-registry-key.js";
import { NpmPackageBuildSystem } from "../../../todl-build-system/npm/npm-package-build-system.js";
import { TodlProjectSystemModule } from "../todl-project-system-module.js";
import { TodlNodeProjectSystemModule } from "../todl-node-project-system-module.js";
import { ProjectSystemContribution } from "../project-system-contribution.js";
import { HtmlBundleBuildSystem } from "../../../todl-build-system/html-bundle/html-bundle-build-system.js";

const NpmPackageId = "npm-package";
const HtmlBundleId = "html-bundle";

describe("TodlProjectSystemModule", () =>
{
    test("RegisterServices seeds the same registries as ProjectSystemComposer.Compose", () =>
    {
        const provider = new ServiceProvider();
        new TodlProjectSystemModule().RegisterServices(provider);

        const factories = provider.getRequired(ProjectFactoryRegistryKey);
        assert.ok(factories.factoryFor(MetaModelProjectFactory.ProjectType) instanceof MetaModelProjectFactory);

        const buildSystems = provider.getRequired(BuildSystemRegistryKey);
        assert.ok(buildSystems.Get(NpmPackageId) instanceof NpmPackageBuildSystem);

        const baker = provider.getRequired(PresentationBakerKey);
        assert.ok(baker instanceof DefaultPresentationBaker);
    });

    test("the browser-safe module never registers the node-bound html-bundle build system", () =>
    {
        const provider = new ServiceProvider();
        new TodlProjectSystemModule().RegisterServices(provider);

        assert.equal(provider.getRequired(BuildSystemRegistryKey).Get(HtmlBundleId), undefined);
    });
});

describe("TodlNodeProjectSystemModule", () =>
{
    test("RegisterServices seeds the core registries plus html-bundle", () =>
    {
        const provider = new ServiceProvider();
        new TodlNodeProjectSystemModule().RegisterServices(provider);

        const factories = provider.getRequired(ProjectFactoryRegistryKey);
        assert.ok(factories.factoryFor(MetaModelProjectFactory.ProjectType) instanceof MetaModelProjectFactory);

        const buildSystems = provider.getRequired(BuildSystemRegistryKey);
        assert.ok(buildSystems.Get(NpmPackageId) instanceof NpmPackageBuildSystem);
        assert.ok(buildSystems.Get(HtmlBundleId) instanceof HtmlBundleBuildSystem);
    });
});

describe("ProjectSystemContribution", () =>
{
    test("Contribute seeds the same registries headlessly, via a bare CompositionRoot", () =>
    {
        const root = new CompositionRoot();
        new ProjectSystemContribution().Contribute(root);

        const factories = root.Provider.getRequired(ProjectFactoryRegistryKey);
        assert.ok(factories.factoryFor(MetaModelProjectFactory.ProjectType) instanceof MetaModelProjectFactory);

        const buildSystems = root.Provider.getRequired(BuildSystemRegistryKey);
        assert.ok(buildSystems.Get(NpmPackageId) instanceof NpmPackageBuildSystem);
        assert.ok(buildSystems.Get(HtmlBundleId) instanceof HtmlBundleBuildSystem, "headless keeps html-bundle");

        const baker = root.Provider.getRequired(PresentationBakerKey);
        assert.ok(baker instanceof DefaultPresentationBaker);
    });
});
