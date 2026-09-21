import { test, describe, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FakeStorage, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { NodeFsStorage } from "@pragmatic-tech-ai/todl-runtime/node";
import { BuildSystemRegistry } from "../../../build-system-core/build-system-registry.js";
import { NpmPackageBuildSystem } from "../../npm/npm-package-build-system.js";
import { SolutionBuildManager } from "../solution-build-manager.js";
import { EmptyPackageSource } from "../../tests/fakes.js";
import { ProjectBuildStatus } from "../../../build-system-core/build-result.js";
import { parseManifest, type ProjectManifest } from "../../../package-manager/manifest.js";
import type { IBuildStorageProvider, OpenedOutput } from "../../../build-system-core/build-storage-provider.js";
import type { BuildOptions } from "../../../build-system-core/build-options.js";

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

describe("SolutionBuildManager", () =>
{
    test("builds a solution in dependency order; a library resolves its meta-model from the fresh build output", async (t) =>
    {
        const meta = fsProject("meta-models/tech-architecture");
        const lib = fsProject("libraries/microsoft");
        const registry = new BuildSystemRegistry();
        registry.Register(new NpmPackageBuildSystem());
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
        registry.Register(new NpmPackageBuildSystem());
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
