import { test, describe, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
    FakeStorage,
    type IStorage,
    type IPromptService,
    type IServiceProvider,
} from "@pragmatic-tech-ai/todl-runtime";
import { NodeFsStorage } from "@pragmatic-tech-ai/todl-runtime/node";
import { BuildSystemRegistry } from "../../../build-system-core/build-system-registry.js";
import { NpmPackageBuildSystem } from "../../npm/npm-package-build-system.js";
import { FakePresentationBaker } from "../../../project-services/core/tests/fake-producer-seams.js";
import { SolutionBuildManager } from "../solution-build-manager.js";
import { EmptyPackageSource } from "../../tests/fakes.js";
import { ProjectBuildStatus } from "../../../build-system-core/build-result.js";
import { parseManifest, type ProjectManifest } from "../../../package-manager/manifest.js";
import type { IBuildStorageProvider, OpenedOutput } from "../../../build-system-core/build-storage-provider.js";
import type { BuildOptions } from "../../../build-system-core/build-options.js";
import { SolutionManagerService } from "../../../solution-manager/engine/solution-manager-service.js";
import type {
    IStorageProviderRegistry,
    IProjectFactoryRegistry,
} from "../../../solution-manager/engine/host-services.js";
import { FakeRegistry } from "../../../package-manager/engine/tests/fakes.js";

const PROJECTS = join(dirname(fileURLToPath(import.meta.url)), "../../../../../test_projects");

function fsProject(rel: string): { Id: string; Project: IStorage; Manifest: ProjectManifest }
{
    const dir = join(PROJECTS, rel);
    const manifest = parseManifest(readFileSync(join(dir, "project.plexus"), "utf8"));
    return { Id: manifest.id ?? manifest.name, Project: new NodeFsStorage(dir), Manifest: manifest };
}

// A provider backing each project's sandbox and output with real filesystem temp dirs
// (like the factory/integration tests). Promote is a filesystem copy — exercising it over
// a real IStorage round-trips model.json faithfully (no in-memory byte-codec fidelity gap),
// and keyed outputs let the manager read a built model.json back to feed the output source.
class MultiOutputProvider implements IBuildStorageProvider
{
    private readonly outputs = new Map<string, NodeFsStorage>();
    private sandboxCounter = 0;

    constructor(private readonly root: string) {}

    public static async Create(t: TestContext): Promise<MultiOutputProvider>
    {
        const root = await mkdtemp(join(tmpdir(), "todl-sln-"));
        t.after(async () => { await rm(root, { recursive: true, force: true }); });
        return new MultiOutputProvider(root);
    }

    public async CreateSandbox(): Promise<IStorage>
    {
        const dir = join(this.root, `sandbox-${this.sandboxCounter++}`);
        const storage = new NodeFsStorage(dir);
        await storage.CreateDirectory("");
        return storage;
    }

    public async DeleteSandbox(sandbox: IStorage): Promise<void>
    {
        await sandbox.Delete("");
    }

    public async OpenOutput(outputName: string, options: BuildOptions): Promise<OpenedOutput>
    {
        const key = `${options.OutputRootOverride ?? ""}--${outputName}`;
        let storage = this.outputs.get(key);
        if (storage === undefined)
        {
            storage = new NodeFsStorage(join(this.root, "out", key));
            await storage.CreateDirectory("");
            this.outputs.set(key, storage);
        }
        return { Storage: storage, Path: key };
    }
}

// A single-project meta-model producer (no cross-project dependency needed): the
// npm-package build system's npm-publish flavor promotes it to a package layout and
// then runs PublishPackageAction, so building it is enough to exercise threading
// SolutionManagerService.PublishRegistry -> SolutionBuildRequest -> TodlBuildContext.
async function producerProject(): Promise<{ Id: string; Project: IStorage; Manifest: ProjectManifest }>
{
    const storage = new FakeStorage();
    await storage.WriteText("project.plexus", JSON.stringify({ type: "meta-model", name: "widgets", version: 1, id: "widgets", packageVersion: "0.1.0" }));
    await storage.WriteText("model.todl", "namespace acme { concept Widget { label : string?; } }");
    const manifest = parseManifest(await storage.ReadText("project.plexus"));
    return { Id: manifest.id ?? manifest.name, Project: storage, Manifest: manifest };
}

// A prompt service SolutionManagerService's ctor requires but this fixture never
// drives (no dirty-solution / Save-As flow is exercised) — every method rejects.
class StubPromptService implements IPromptService
{
    private static readonly NotExercisedMessage = "StubPromptService: not exercised by this fixture";

    public Ask<R>(): Promise<R>
    {
        return Promise.reject(new Error(StubPromptService.NotExercisedMessage));
    }
    public Confirm(): Promise<boolean>
    {
        return Promise.reject(new Error(StubPromptService.NotExercisedMessage));
    }
    public PickFolder(): Promise<string | undefined>
    {
        return Promise.reject(new Error(StubPromptService.NotExercisedMessage));
    }
    public PickFile(): Promise<string | undefined>
    {
        return Promise.reject(new Error(StubPromptService.NotExercisedMessage));
    }
    public PromptText(): Promise<string | undefined>
    {
        return Promise.reject(new Error(StubPromptService.NotExercisedMessage));
    }
    public Choose<T>(): Promise<T | undefined>
    {
        return Promise.reject(new Error(StubPromptService.NotExercisedMessage));
    }
}

// Builds a bare SolutionManagerService through its real constructor, with minimal
// fakes for the host seams it requires but this fixture never drives — just enough
// to hold and hand back a PublishRegistry (Task 10's authoritative holder).
function makeSolutionManagerService(): SolutionManagerService
{
    const storages: IStorageProviderRegistry = {
        CreateStorage: (folder: string) => new FakeStorage(folder),
    };
    const factories: IProjectFactoryRegistry = {
        factoryFor: () => undefined,
        All: () => [],
    };
    const prompts = new StubPromptService();
    const packages = {
        resolve: () => Promise.reject(new Error("PackageSource: not exercised by this fixture")),
    };
    const provider = {
        get: () => undefined,
        getRequired: (token: unknown) =>
        {
            if (token === SolutionManagerService.StorageRegistryKey) return storages;
            if (token === SolutionManagerService.ProjectFactoryRegistryKey) return factories;
            if (token === SolutionManagerService.PromptServiceKey) return prompts;
            if (token === SolutionManagerService.PackageSourceKey) return packages;
            throw new Error(`unexpected service key: ${String(token)}`);
        },
        has: () => true,
    } as unknown as IServiceProvider;
    return new SolutionManagerService(provider);
}

describe("SolutionBuildManager — PublishRegistry threading (Task 10)", () =>
{
    test("SolutionManagerService.PublishRegistry threads through a publish-flavor build: the fake registry's Publish is called", async (t) =>
    {
        const service = makeSolutionManagerService();
        const registry = new FakeRegistry();
        service.PublishRegistry = registry;
        const project = await producerProject();

        const buildSystemRegistry = new BuildSystemRegistry();
        buildSystemRegistry.Register(new NpmPackageBuildSystem(new FakePresentationBaker()));
        const manager = new SolutionBuildManager(buildSystemRegistry, await MultiOutputProvider.Create(t));

        const result = await manager.Build({
            Projects: [project],
            BuildSystemId: "npm-package",
            BuildFlavorId: "npm-publish",
            ExternalSource: new EmptyPackageSource(),
            PublishRegistry: service.PublishRegistry,
        });

        assert.equal(result.Ok, true, JSON.stringify(result.Projects.map((p) => p.Result?.Diagnostics)));
        assert.equal(registry.Published.length, 1);
    });

    test("with SolutionManagerService.PublishRegistry left undefined, the publish-flavor build fails with the no-registry diagnostic and never publishes", async (t) =>
    {
        const service = makeSolutionManagerService();
        // PublishRegistry left undefined — mirrors a solution with no registry connection configured.
        const project = await producerProject();

        const buildSystemRegistry = new BuildSystemRegistry();
        buildSystemRegistry.Register(new NpmPackageBuildSystem(new FakePresentationBaker()));
        const manager = new SolutionBuildManager(buildSystemRegistry, await MultiOutputProvider.Create(t));

        const result = await manager.Build({
            Projects: [project],
            BuildSystemId: "npm-package",
            BuildFlavorId: "npm-publish",
            ExternalSource: new EmptyPackageSource(),
            // exactOptionalPropertyTypes: an optional field takes "absent", not an
            // explicit `undefined` value — so this mirrors the request the host would
            // build from a service with no registry configured.
            ...(service.PublishRegistry !== undefined ? { PublishRegistry: service.PublishRegistry } : {}),
        });

        assert.equal(result.Ok, false);
        const diagnostics = result.Projects.flatMap((p) => p.Result?.Diagnostics ?? []);
        assert.equal(diagnostics.some((d) => /no registry/.test(d.message)), true);
    });
});

describe("SolutionBuildManager", () =>
{
    test("builds a solution in dependency order; a library resolves its meta-model from the fresh build output", async (t) =>
    {
        const meta = fsProject("meta-models/tech-architecture");
        const lib = fsProject("libraries/microsoft");
        const registry = new BuildSystemRegistry();
        registry.Register(new NpmPackageBuildSystem(new FakePresentationBaker()));
        const manager = new SolutionBuildManager(registry, await MultiOutputProvider.Create(t));

        // Projects listed dependent-first to prove the manager reorders; external source
        // is empty, so the library can ONLY resolve its base from the built meta-model.
        const result = await manager.Build({
            Projects: [lib, meta],
            BuildSystemId: "npm-package",
            ExternalSource: new EmptyPackageSource(),
        });

        assert.equal(result.Ok, true, JSON.stringify(result.Projects.map((p) => ({ p: p.ProjectId, d: p.Result?.Diagnostics }))));
        assert.equal(result.Order.indexOf(meta.Id) < result.Order.indexOf(lib.Id), true);
        assert.deepEqual(result.Projects.map((p) => p.Status), [ProjectBuildStatus.Built, ProjectBuildStatus.Built]);
    });

    test("a dependency cycle is reported and no project builds", async (t) =>
    {
        const registry = new BuildSystemRegistry();
        registry.Register(new NpmPackageBuildSystem(new FakePresentationBaker()));
        const manager = new SolutionBuildManager(registry, await MultiOutputProvider.Create(t));
        // Two libraries that (via explicit edges) depend on each other.
        const a = { Id: "a", Project: new FakeStorage(), Manifest: { type: "library", name: "a", version: 1, id: "a" } as ProjectManifest };
        const b = { Id: "b", Project: new FakeStorage(), Manifest: { type: "library", name: "b", version: 1, id: "b" } as ProjectManifest };

        const result = await manager.Build({
            Projects: [a, b],
            BuildSystemId: "npm-package",
            ExternalSource: new EmptyPackageSource(),
            ExplicitEdges: [["a", "b"], ["b", "a"]],
        });

        assert.equal(result.Ok, false);
        assert.equal(result.Order.length, 0);
        assert.equal(result.Diagnostics.some((d) => /cycle/i.test(d.message)), true);
    });
});
