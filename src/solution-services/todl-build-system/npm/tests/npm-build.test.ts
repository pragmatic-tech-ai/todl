import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildSystemRegistry } from "../../../build-system-core/build-system-registry.js";
import { TodlProjectBuildManager } from "../../todl-project-build-manager.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { NpmPackageBuildSystem } from "../npm-package-build-system.js";
import { FakeStorageProvider, EmptyPackageSource } from "../../tests/fakes.js";
import { parseManifest, type ProjectManifest } from "../../../package-manager/manifest.js";
import type { BuildResult } from "../../../build-system-core/build-result.js";
import { PackageKind, type PackageRef } from "../../../../publish/publish.js";
import type { IPackageSource, SourcedPackage } from "../../package-source.js";

const META = "namespace acme { concept Widget { label : string?; } }";

async function metaProject(): Promise<FakeStorage>
{
    const storage = new FakeStorage();
    await storage.WriteText("project.plexus", JSON.stringify({ type: "meta-model", name: "widgets", version: 1, id: "widgets", packageVersion: "0.1.0" }));
    await storage.WriteText("model.todl", META);
    await storage.WriteText("README.md", "# widgets");
    return storage;
}

async function runNpm(project: FakeStorage): Promise<{ result: BuildResult; provider: FakeStorageProvider }>
{
    const manifest = parseManifest(await project.ReadText("project.plexus"));
    const registry = new BuildSystemRegistry<TodlBuildContext, ProjectManifest>();
    registry.Register(new NpmPackageBuildSystem());
    const provider = new FakeStorageProvider();
    const manager = new TodlProjectBuildManager(registry, provider);
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

    test("applies to meta-model, library, and architecture projects", () =>
    {
        const system = new NpmPackageBuildSystem();
        assert.equal(system.AppliesTo({ type: "meta-model", name: "m", version: 1 } as never), true);
        assert.equal(system.AppliesTo({ type: "library", name: "l", version: 1 } as never), true);
        assert.equal(system.AppliesTo({ type: "architecture", name: "a", version: 1 } as never), true);
    });

    test("inserts host content generators between compile and emit", () =>
    {
        const generator = { Name: "generate-presentation", Consumes: [], Produces: [], Execute: () => Promise.resolve() };
        const names = new NpmPackageBuildSystem([generator]).Flavors()[0].Actions().map((a) => a.Name);
        assert.deepEqual(names, ["resolve-bases", "compile-model", "generate-presentation", "emit-package-layout"]);
    });
});

class OnePackageSource implements IPackageSource
{
    constructor(private readonly id: string, private readonly package_: SourcedPackage) {}
    public TryGet(ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        return Promise.resolve(ref.id === this.id ? this.package_ : undefined);
    }
}

async function archProject(): Promise<FakeStorage>
{
    const storage = new FakeStorage();
    await storage.WriteText("project.plexus", JSON.stringify({
        type: "architecture", name: "my-arch", version: 1,
        id: "my-arch", packageVersion: "0.1.0",
        architectures: [{ id: "base-arch", version: "0.1.0" }],
    }));
    await storage.WriteText("model.todl", "namespace acme { concept App { label : string?; } model M : acme { App a1 { label = \"A1\"; } } }");
    return storage;
}

async function runNpmWith(project: FakeStorage, source: IPackageSource): Promise<{ result: BuildResult; provider: FakeStorageProvider }>
{
    const manifest = parseManifest(await project.ReadText("project.plexus"));
    const registry = new BuildSystemRegistry<TodlBuildContext, ProjectManifest>();
    registry.Register(new NpmPackageBuildSystem());
    const provider = new FakeStorageProvider();
    const manager = new TodlProjectBuildManager(registry, provider);
    const { Result: result } = await manager.Build({ Project: project, Manifest: manifest, BuildSystemId: "npm-package", Source: source });
    return { result, provider };
}

describe("NpmPackageBuildSystem — architecture", () =>
{
    const baseArch: SourcedPackage = { Document: { nodes: [], edges: [] }, Dependencies: [] };

    test("builds an architecture and records its architecture dependency", async () =>
    {
        const { result, provider } = await runNpmWith(await archProject(), new OnePackageSource("base-arch", baseArch));

        assert.equal(result.Ok, true, JSON.stringify(result.Diagnostics));
        const pj = JSON.parse(await provider.Output.ReadText("package.json"));
        assert.equal(pj.todl.kind, "architecture");
        assert.equal(pj.dependencies["@pragmatic-tech-ai/base-arch"], "0.1.0");
        const model = JSON.parse(await provider.Output.ReadText("model.json"));
        assert.ok((model.dependencies ?? []).some((d: PackageRef) => d.kind === PackageKind.Architecture && d.id === "base-arch"));
    });

    test("fails the build when an architecture dependency is unpublished", async () =>
    {
        const { result } = await runNpmWith(await archProject(), new EmptyPackageSource());

        assert.equal(result.Ok, false);
        assert.ok(result.Diagnostics.some((d) => /architecture "base-arch@0\.1\.0" is not published/.test(d.message)));
    });
});
