import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { TodlProjectBuildManager } from "../../todl-project-build-manager.js";
import { TodlBuildSystemRegistry } from "../../todl-build-system-registry.js";
import { HtmlBundleBuildSystem } from "../html-bundle-build-system.js";
import { FakeStorageProvider, EmptyPackageSource } from "../../tests/fakes.js";
import { parseManifest, ProjectType } from "../../../package-manager/manifest.js";

async function archProject(): Promise<FakeStorage>
{
    const storage = new FakeStorage();
    await storage.WriteText("project.plexus", JSON.stringify({
        type: "architecture", name: "my-arch", version: 1, id: "my-arch", packageVersion: "0.1.0",
    }));
    await storage.WriteText("model.todl", "namespace acme { concept App { label : string?; } model M : acme { App a1 { label = \"A1\"; } } }");
    return storage;
}

describe("HtmlBundleBuildSystem", () =>
{
    test("applies to architecture projects only", () =>
    {
        const system = new HtmlBundleBuildSystem();
        assert.equal(system.AppliesTo({ type: "architecture", name: "a", version: 1 } as never), true);
        assert.equal(system.AppliesTo({ type: "meta-model", name: "m", version: 1 } as never), false);
        assert.equal(system.AppliesTo({ type: "library", name: "l", version: 1 } as never), false);
    });

    test("the registry offers html-bundle for architecture, not for meta-model", () =>
    {
        const registry = new TodlBuildSystemRegistry();
        assert.equal(registry.For({ type: ProjectType.Architecture, name: "a" } as never).some((s) => s.Id === "html-bundle"), true);
        assert.equal(registry.For({ type: ProjectType.MetaModel, name: "m" } as never).some((s) => s.Id === "html-bundle"), false);
    });

    test("emits a self-contained index.html with the model + app bundle inlined", async () =>
    {
        const project = await archProject();
        const manifest = parseManifest(await project.ReadText("project.plexus"));
        const provider = new FakeStorageProvider();
        const manager = new TodlProjectBuildManager(new TodlBuildSystemRegistry(), provider);

        const { Result: result } = await manager.Build({ Project: project, Manifest: manifest, BuildSystemId: "html-bundle", Source: new EmptyPackageSource() });
        assert.equal(result.Ok, true, JSON.stringify(result.Diagnostics));

        const html = await provider.Output.ReadText("index.html");
        assert.match(html, /id="todl-app-root"/);
        assert.match(html, /__TODL_DOCUMENT__/);
        assert.match(html, /FromDocument/);              // the graph-app bundle is inlined
        assert.match(html, /App/);                        // the compiled document is inlined
    });
});
