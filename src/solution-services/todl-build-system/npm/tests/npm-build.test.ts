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
import { FakePresentationBaker } from "../../../project-services/core/tests/fake-producer-seams.js";

const META = "namespace acme { concept Widget { label : string?; } }";
const VALID_APP_MU = "Application { resources: { Border x:root {} } }\n";

async function metaProject(): Promise<FakeStorage>
{
    const storage = new FakeStorage();
    await storage.WriteText("project.plexus", JSON.stringify({ type: "meta-model", name: "widgets", version: 1, id: "widgets", packageVersion: "0.1.0" }));
    await storage.WriteText("model.todl", META);
    await storage.WriteText("README.md", "# widgets");
    return storage;
}

// A library declaring a real `@icon` resource (so DeclaresResources/stamp/bake all gate
// open) plus a `.mu` view (so compile-mural has something to compile) — for the
// full-pipeline test below.
async function libraryProjectWithIconAndMu(): Promise<FakeStorage>
{
    const storage = new FakeStorage();
    await storage.WriteText("project.plexus", JSON.stringify({ type: "library", name: "widgets", version: 1, id: "widgets", packageVersion: "0.1.0" }));
    await storage.WriteText("model.todl", 'namespace acme { concept Widget { label : string?; annotate icon { path = "visuals/w.svg"; } } }');
    await storage.WriteText("visuals/w.svg", "<svg></svg>");
    await storage.WriteText("views/app.mu", VALID_APP_MU);
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

    test("wires the fixed action pipeline: resolve -> compile -> mural -> stamp -> bake -> emit", () =>
    {
        const system = new NpmPackageBuildSystem();
        const flavor = system.Flavors()[0];
        assert.deepEqual(flavor.Actions().map((a) => a.Name), [
            "resolve-bases", "compile-model", "compile-mural",
            "stamp-resource-keys", "bake-resources", "emit-package-layout",
        ]);
    });

    test("compiles .mu into compiled/*.mu.js and excludes the raw .mu from resources/", async () =>
    {
        const project = await metaProject();
        await project.WriteText("views/app.mu", VALID_APP_MU);

        const { result, provider } = await runNpm(project);

        assert.equal(result.Ok, true, JSON.stringify(result.Diagnostics));
        assert.equal(await provider.Output.Exists("compiled/app.mu.js"), true, "compiled the .mu view");
        assert.equal(await provider.Output.Exists("resources/views/app.mu"), false, "did not double-ship the raw .mu");
    });

    test("a supplied baker reaches BakeResourcesAction, model.json carries stamped keys, and no raw .mu ships", async () =>
    {
        const project = await libraryProjectWithIconAndMu();
        const manifest = parseManifest(await project.ReadText("project.plexus"));
        const baker = new FakePresentationBaker();
        const registry = new BuildSystemRegistry<TodlBuildContext, ProjectManifest>();
        registry.Register(new NpmPackageBuildSystem(baker));
        const provider = new FakeStorageProvider();
        const manager = new TodlProjectBuildManager(registry, provider);

        const { Result: result } = await manager.Build({ Project: project, Manifest: manifest, BuildSystemId: "npm-package", Source: new EmptyPackageSource() });

        assert.equal(result.Ok, true, JSON.stringify(result.Diagnostics));

        // (a) the baker was invoked.
        assert.equal(baker.calls.length, 1);

        // (b) model.json carries the stamped key.
        const model = JSON.parse(await provider.Output.ReadText("model.json")) as { nodes: Array<{ type: string | null; attrs: Record<string, unknown> }> };
        const stamped = model.nodes.some((n) => n.type === "icon" && typeof n.attrs["key"] === "string");
        assert.ok(stamped, "an icon node in model.json carries a stamped resource key");

        // (c) the .mu view compiled.
        assert.equal(await provider.Output.Exists("compiled/app.mu.js"), true);

        // (d) no raw .mu shipped under resources/.
        assert.equal(await provider.Output.Exists("resources/views/app.mu"), false);
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
