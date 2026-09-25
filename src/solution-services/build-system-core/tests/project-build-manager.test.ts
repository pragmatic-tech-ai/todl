import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage, type IStorage } from "@pragmatic-tech-ai/todl-runtime";
import { ArtifactKey } from "../artifact-key.js";
import { BuildSystemRegistry } from "../build-system-registry.js";
import { ProjectBuildManager } from "../project-build-manager.js";
import type { CoreBuildContext, IBuildAction } from "../build-action.js";
import type { IBuildSystem } from "../build-system.js";
import { StaticBuildFlavor, type BuildFlavor, type RequiredContent } from "../build-flavor.js";
import type { IBuildStorageProvider, OpenedOutput } from "../build-storage-provider.js";
import type { BuildOptions } from "../build-options.js";
import { BuildStatus } from "../build-result.js";

// A minimal build target — the manager is generic over it, and this test stays free of
// any todl type (Part B is verified entirely against build-system-core).
interface FakeTarget
{
    type: string;
}

// Records whether it ran, so a test can assert the unmet-Requires path runs NO action.
class SpyAction implements IBuildAction<CoreBuildContext>
{
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];
    public Ran = false;

    constructor(public readonly Name: string)
    {
    }

    public async Execute(ctx: CoreBuildContext): Promise<void>
    {
        this.Ran = true;
        await ctx.Sandbox.WriteText("out.txt", "x");
    }
}

class FakeSystem implements IBuildSystem<CoreBuildContext, FakeTarget>
{
    public readonly DisplayName = "fake";

    constructor(public readonly Id: string, private readonly flavor: BuildFlavor<CoreBuildContext>)
    {
    }

    public AppliesTo(): boolean
    {
        return true;
    }

    public Flavors(): readonly BuildFlavor<CoreBuildContext>[]
    {
        return [this.flavor];
    }
}

// Hands out fresh in-memory sandboxes and a shared in-memory output, backed by FakeStorage
// (adapted from the smoke test's TempBuildStorage / todl-build-system's FakeStorageProvider,
// swapped to in-memory since core tests stay filesystem-free).
class FakeBuildStorageProvider implements IBuildStorageProvider
{
    public readonly Output = new FakeStorage();

    public CreateSandbox(): Promise<IStorage>
    {
        return Promise.resolve(new FakeStorage());
    }

    public DeleteSandbox(): Promise<void>
    {
        return Promise.resolve();
    }

    public OpenOutput(outputName: string, _options: BuildOptions): Promise<OpenedOutput>
    {
        return Promise.resolve({ Storage: this.Output, Path: `/build/${outputName}` });
    }
}

function managerWith(flavor: BuildFlavor<CoreBuildContext>): {
    manager: ProjectBuildManager<CoreBuildContext, FakeTarget>;
    provider: FakeBuildStorageProvider;
}
{
    const registry = new BuildSystemRegistry<CoreBuildContext, FakeTarget>();
    registry.Register(new FakeSystem("fake", flavor));
    const provider = new FakeBuildStorageProvider();
    const manager = new ProjectBuildManager<CoreBuildContext, FakeTarget>(registry, provider, (base) => base);
    return { manager, provider };
}

const REQUIRES: readonly RequiredContent[] = [{ Path: "generated/model.ts", GeneratorId: "model-dto" }];

describe("ProjectBuildManager — Requires precondition", () =>
{
    test("a missing required file fails fast, before any action runs", async () =>
    {
        const spy = new SpyAction("emit");
        const flavor = new StaticBuildFlavor<CoreBuildContext>("fake", "fake", "fake-output", [spy], REQUIRES);
        const { manager } = managerWith(flavor);
        const project = new FakeStorage();

        const { Result } = await manager.Build({
            Project: project,
            Id: "proj",
            Target: { type: "fake" },
            BuildSystemId: "fake",
        });

        assert.equal(Result.Ok, false);
        assert.equal(Result.Status, BuildStatus.Failed);
        assert.equal(Result.Actions.length, 0);
        assert.ok(
            Result.Diagnostics.some((d) => d.message.includes("generated/model.ts") && d.message.includes("model-dto")),
            `expected a diagnostic naming the path + generator, got ${JSON.stringify(Result.Diagnostics)}`,
        );
        assert.equal(spy.Ran, false, "no action should run on the unmet-Requires path");
    });

    test("a present required file lets the pipeline run", async () =>
    {
        const spy = new SpyAction("emit");
        const flavor = new StaticBuildFlavor<CoreBuildContext>("fake", "fake", "fake-output", [spy], REQUIRES);
        const { manager } = managerWith(flavor);
        const project = new FakeStorage();
        await project.WriteText("generated/model.ts", "export {};");

        const { Result } = await manager.Build({
            Project: project,
            Id: "proj",
            Target: { type: "fake" },
            BuildSystemId: "fake",
        });

        assert.equal(spy.Ran, true);
        assert.equal(Result.Ok, true);
        assert.equal(Result.Status, BuildStatus.Succeeded);
    });

    test("an empty Requires list (the default) never blocks the pipeline", async () =>
    {
        const spy = new SpyAction("emit");
        const flavor = new StaticBuildFlavor<CoreBuildContext>("fake", "fake", "fake-output", [spy]);
        const { manager } = managerWith(flavor);

        const { Result } = await manager.Build({
            Project: new FakeStorage(),
            Id: "proj",
            Target: { type: "fake" },
            BuildSystemId: "fake",
        });

        assert.equal(spy.Ran, true);
        assert.equal(Result.Ok, true);
    });
});
