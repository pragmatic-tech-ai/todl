import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { ProjectType } from "../../package-manager/manifest.js";
import { TodlBuildSystemRegistry } from "../todl-build-system-registry.js";
import { TodlBuildSettings } from "../todl-build-settings.js";
import { TodlBuildSystemEngine } from "../todl-build-system-module.mu.js";

describe("todl-build-system composition", () =>
{
    test("TodlBuildSystemRegistry pre-registers the npm-package build system", () =>
    {
        const registry = new TodlBuildSystemRegistry();
        const system = registry.Get("npm-package");
        assert.ok(system !== undefined);
        assert.equal(system!.OutputName, "npm-package");
    });

    test("the npm-package system applies to meta-model, library, and architecture targets", () =>
    {
        const registry = new TodlBuildSystemRegistry();
        assert.equal(registry.For({ type: ProjectType.MetaModel, name: "m" } as never).length, 1);
        assert.equal(registry.For({ type: ProjectType.Library, name: "l" } as never).length, 1);
        assert.equal(registry.For({ type: ProjectType.Architecture, name: "a" } as never).length, 1);
    });

    test("the build settings bag exposes the output-dir + colored-presentation fields", () =>
    {
        const bag = TodlBuildSettings.Definition();
        assert.equal(bag.Id, "build");
        const keys = bag.Fields.map((f) => f.Key);
        assert.deepEqual(keys, ["outputDir", "coloredPresentation"]);
    });

    test("composing the module registers a resolvable, populated build-system registry", () =>
    {
        const provider = new ServiceProvider();
        TodlBuildSystemEngine.RegisterServices(provider);
        const registry = provider.getRequired(ServiceProvider.tokenFor(TodlBuildSystemRegistry));
        assert.ok(registry.Get("npm-package") !== undefined);
    });
});
