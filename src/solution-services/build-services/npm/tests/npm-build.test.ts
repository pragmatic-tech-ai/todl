import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildSystemRegistry } from "../../build-system-registry.js";
import { ProjectBuildManager } from "../../project-build-manager.js";
import { NpmPackageBuildSystem } from "../npm-package-build-system.js";
import { FakeStorageProvider, EmptyPackageSource } from "../../tests/fakes.js";
import { parseManifest } from "../../../package-manager/manifest.js";
import type { BuildResult } from "../../build-result.js";

const META = "namespace acme { concept Widget { label : string?; } }";

async function metaProject(): Promise<FakeStorage>
{
    const storage = new FakeStorage();
    await storage.WriteText("project.plexus", JSON.stringify({ type: "meta-model", name: "widgets", version: 1, id: "widgets", modelVersion: "0.1.0" }));
    await storage.WriteText("model.todl", META);
    await storage.WriteText("README.md", "# widgets");
    return storage;
}

async function runNpm(project: FakeStorage): Promise<{ result: BuildResult; provider: FakeStorageProvider }>
{
    const manifest = parseManifest(await project.ReadText("project.plexus"));
    const registry = new BuildSystemRegistry();
    registry.Register(new NpmPackageBuildSystem());
    const provider = new FakeStorageProvider();
    const manager = new ProjectBuildManager(registry, provider);
    const { Result: result } = await manager.Build({ Project: project, Manifest: manifest, BuildSystemId: "npm-package", Source: new EmptyPackageSource() });
    return { result, provider };
}

describe("NpmPackageBuildSystem", () =>
{
    test("compiles a meta-model project into the npm package layout", async () =>
    {
        const { result, provider } = await runNpm(await metaProject());

        assert.equal(result.Ok, true, JSON.stringify(result.Diagnostics));
        for (const f of ["package.json", "model.json", "index.js", "index.d.ts"])
        {
            assert.equal(await provider.Output.Exists(f), true, `wrote ${f}`);
        }
        const pj = JSON.parse(await provider.Output.ReadText("package.json"));
        assert.equal(pj.todl.id, "widgets");
        assert.match(await provider.Output.ReadText("index.js"), /export const document =/);
    });

    test("packs non-.todl project files under resources/", async () =>
    {
        const { provider } = await runNpm(await metaProject());
        assert.equal(await provider.Output.Exists("resources/README.md"), true);
        // the manifest + .todl sources are not resources
        assert.equal(await provider.Output.Exists("resources/project.plexus"), false);
        assert.equal(await provider.Output.Exists("resources/model.todl"), false);
    });

    test("applies to meta-model and library projects, not architecture", () =>
    {
        const system = new NpmPackageBuildSystem();
        assert.equal(system.AppliesTo({ type: "meta-model", name: "m", version: 1 } as never), true);
        assert.equal(system.AppliesTo({ type: "library", name: "l", version: 1 } as never), true);
        assert.equal(system.AppliesTo({ type: "architecture", name: "a", version: 1 } as never), false);
    });
});
