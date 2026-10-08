import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { BundlerKey } from "../../../build-system-core/bundler.js";
import { EsbuildBundler } from "../../../todl-build-system/html-bundle/node/esbuild-bundler.js";
import { HtmlBundleBuildSystem } from "../../../todl-build-system/html-bundle/html-bundle-build-system.js";
import { ProjectType } from "../../../package-manager/manifest.js";
import { BuildSystemRegistryKey } from "../build-system-registry-key.js";
import { ProjectSystemComposer } from "../project-system-composer.js";
import { NodeProjectSystemComposer } from "../node-project-system-composer.js";

class NodeCompositionFixture
{
    public static readonly HtmlBundleId = "html-bundle";
    public static readonly ProjectName = "a";

    public static Composed(): ServiceProvider
    {
        const provider = new ServiceProvider();
        NodeProjectSystemComposer.Compose(provider);
        return provider;
    }
}

describe("NodeProjectSystemComposer", () =>
{
    test("binds BundlerKey to an EsbuildBundler", () =>
    {
        const provider = NodeCompositionFixture.Composed();

        assert.ok(provider.getRequired(BundlerKey) instanceof EsbuildBundler);
    });

    test("registers an html-bundle build system applicable to architecture projects", () =>
    {
        const registry = NodeCompositionFixture.Composed().getRequired(BuildSystemRegistryKey);
        const project = { type: ProjectType.Architecture, name: NodeCompositionFixture.ProjectName } as never;

        assert.equal(registry.For(project).some((s) => s.Id === NodeCompositionFixture.HtmlBundleId), true);
    });

    test("HtmlBundleBuildSystem.Register fails when BundlerKey is unbound", () =>
    {
        // Core compose seeds the registry but no bundler, so any throw is the missing BundlerKey.
        const provider = new ServiceProvider();
        ProjectSystemComposer.Compose(provider);

        assert.throws(() => HtmlBundleBuildSystem.Register(provider), /BundlerKey|Bundler/);
    });
});
