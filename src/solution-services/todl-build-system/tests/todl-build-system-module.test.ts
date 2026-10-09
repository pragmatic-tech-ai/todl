import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider, FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { TypeCheckerKey, type ITypeChecker } from "../../build-system-core/type-checker.js";
import { Severity } from "../../build-system-core/diagnostic-sink.js";
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
        assert.equal(system!.Flavors()[0].OutputName, "npm-package");
    });

    test("the npm-package system applies to meta-model, library, and architecture targets", () =>
    {
        const registry = new TodlBuildSystemRegistry();
        assert.equal(registry.For({ type: ProjectType.MetaModel, name: "m" } as never).length, 1);
        assert.equal(registry.For({ type: ProjectType.Library, name: "l" } as never).length, 1);
        assert.equal(registry.For({ type: ProjectType.Architecture, name: "a" } as never).length, 2);
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

    test("the module DSL provider supplies the html-bundle type checker (provider is not bound as the checker)", async () =>
    {
        class SentinelChecker implements ITypeChecker
        {
            public calls = 0;
            public async Check() { this.calls++; return { Diagnostics: [] }; }
        }
        const sentinel = new SentinelChecker();
        const provider = new ServiceProvider();
        provider.registerInstance(TypeCheckerKey, sentinel);
        TodlBuildSystemEngine.RegisterServices(provider);
        const registry = provider.getRequired(ServiceProvider.tokenFor(TodlBuildSystemRegistry));
        const action = registry.Get("html-bundle")!.Flavors()[0].Actions().find((a) => a.Name === "type-check")!;
        const diagnostics: unknown[] = [];
        const ctx = { Project: new FakeStorage(), Sandbox: new FakeStorage(), Diagnostics: { Report: (d: unknown) => diagnostics.push(d) } } as never;
        await action.Execute(ctx);
        assert.equal(sentinel.calls, 1, "the registered checker was invoked");
        assert.deepEqual(diagnostics, [], `no 'failed to type-check' error (${Severity.Error})`);
    });
});
