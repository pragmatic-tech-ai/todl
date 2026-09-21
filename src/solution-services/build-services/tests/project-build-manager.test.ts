import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ArtifactKey } from "../artifact-key.js";
import { BuildSystemRegistry } from "../build-system-registry.js";
import { ProjectBuildManager } from "../project-build-manager.js";
import { ActionStatus, BuildStatus, ProjectBuildStatus } from "../build-result.js";
import { Severity } from "../diagnostic-sink.js";
import {
    FakeAction,
    FakeSystem,
    FakeStorageProvider,
    RecordingProgress,
    EmptyPackageSource,
    libraryManifest,
} from "./fakes.js";
import { ProjectType } from "../../package-manager/manifest.js";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";

function managerWith(system: FakeSystem, provider = new FakeStorageProvider()): {
    manager: ProjectBuildManager;
    provider: FakeStorageProvider;
}
{
    const registry = new BuildSystemRegistry();
    registry.Register(system);
    return { manager: new ProjectBuildManager(registry, provider), provider };
}

function request(overrides: { progress?: RecordingProgress } = {})
{
    return {
        Project: new FakeStorage(),
        Manifest: libraryManifest(),
        BuildSystemId: "npm",
        Source: new EmptyPackageSource(),
        ...(overrides.progress !== undefined ? { Progress: overrides.progress } : {}),
    };
}

describe("ProjectBuildManager", () =>
{
    test("runs actions in order, promotes the sandbox, reports success + artifacts", async () =>
    {
        const system = new FakeSystem("npm", "npm-package", [
            new FakeAction({ name: "emit-manifest", body: (ctx) => ctx.Sandbox.WriteText("package.json", "{}") }),
            new FakeAction({ name: "emit-model", body: (ctx) => ctx.Sandbox.WriteText("dist/model.json", "{}") }),
        ], ProjectType.Library);
        const { manager, provider } = managerWith(system);

        const result = await manager.Build(request());

        assert.equal(result.Ok, true);
        assert.equal(result.Status, BuildStatus.Succeeded);
        assert.deepEqual(result.Actions.map((a) => a.Status), [ActionStatus.Succeeded, ActionStatus.Succeeded]);
        assert.deepEqual(result.Artifacts, ["dist/model.json", "package.json"]);
        assert.equal(result.OutputPath, "/build/npm-package");
        assert.equal(await provider.Output.ReadText("package.json"), "{}");
    });

    test("threads the artifact bag: a produced value reaches a later action", async () =>
    {
        const key = new ArtifactKey<string>("Compiled");
        const system = new FakeSystem("npm", "npm-package", [
            new FakeAction({ name: "compile", produces: [key], body: (ctx) => { ctx.Artifacts.Set(key, "MODEL"); return Promise.resolve(); } }),
            new FakeAction({ name: "emit", consumes: [key], body: (ctx) => ctx.Sandbox.WriteText("out.txt", ctx.Artifacts.Get(key) ?? "MISSING") }),
        ]);
        const { manager, provider } = managerWith(system);

        await manager.Build(request());

        assert.equal(await provider.Output.ReadText("out.txt"), "MODEL");
    });

    test("writes report.json to the output on success", async () =>
    {
        const system = new FakeSystem("npm", "npm-package", [new FakeAction({ name: "noop" })]);
        const { manager, provider } = managerWith(system);

        await manager.Build(request());

        const report = JSON.parse(await provider.Output.ReadText("report.json"));
        assert.equal(report.Ok, true);
        assert.equal(report.Status, BuildStatus.Succeeded);
    });

    test("fires hierarchical progress milestones in order", async () =>
    {
        const system = new FakeSystem("npm", "npm-package", [
            new FakeAction({ name: "a" }),
            new FakeAction({ name: "b" }),
        ]);
        const { manager } = managerWith(system);
        const progress = new RecordingProgress();

        await manager.Build(request({ progress }));

        assert.deepEqual(progress.Events, [
            "project-start:demo-lib:a,b",
            "action-start:a",
            "action-finish:a:succeeded",
            "action-start:b",
            "action-finish:b:succeeded",
            "project-finish:demo-lib:built",
        ]);
    });

    test("deletes the sandbox after the build", async () =>
    {
        const system = new FakeSystem("npm", "npm-package", [new FakeAction({ name: "noop" })]);
        const { manager, provider } = managerWith(system);

        await manager.Build(request());

        assert.equal(provider.Deleted.length, 1);
        assert.equal(provider.Deleted[0], provider.Sandboxes[0]);
    });

    test("an error diagnostic stops the pipeline; later actions skipped; no promotion", async () =>
    {
        const system = new FakeSystem("npm", "npm-package", [
            new FakeAction({ name: "resolve", body: (ctx) => { ctx.Diagnostics.Report({ severity: Severity.Error, message: "unresolved base" }); return Promise.resolve(); } }),
            new FakeAction({ name: "emit", body: (ctx) => ctx.Sandbox.WriteText("should-not-exist.txt", "x") }),
        ]);
        const { manager, provider } = managerWith(system);
        const progress = new RecordingProgress();

        const result = await manager.Build(request({ progress }));

        assert.equal(result.Ok, false);
        assert.equal(result.Status, BuildStatus.Failed);
        assert.deepEqual(result.Actions.map((a) => a.Status), [ActionStatus.Failed, ActionStatus.Skipped]);
        assert.equal(await provider.Output.Exists("should-not-exist.txt"), false);
        // report.json is written even on failure
        assert.equal(await provider.Output.Exists("report.json"), true);
        assert.ok(progress.Events.includes("project-finish:demo-lib:failed"));
        assert.ok(progress.Events.includes("diag:error:unresolved base"));
    });

    test("a thrown action becomes an error diagnostic and fails the build", async () =>
    {
        const system = new FakeSystem("npm", "npm-package", [
            new FakeAction({ name: "boom", body: () => Promise.reject(new Error("kaboom")) }),
        ]);
        const { manager } = managerWith(system);

        const result = await manager.Build(request());

        assert.equal(result.Ok, false);
        assert.equal(result.Actions[0]!.Status, ActionStatus.Failed);
        assert.ok(result.Diagnostics.some((d) => d.severity === Severity.Error && d.message.includes("kaboom")));
    });

    test("throws for an unknown build system id", async () =>
    {
        const system = new FakeSystem("npm", "npm-package", []);
        const { manager } = managerWith(system);

        await assert.rejects(() => manager.Build({ ...request(), BuildSystemId: "nope" }), /nope/);
    });

    test("throws when the build system does not apply to the project", async () =>
    {
        const system = new FakeSystem("npm", "npm-package", [], ProjectType.MetaModel);
        const { manager } = managerWith(system);

        await assert.rejects(() => manager.Build(request()), /apply/);
    });
});
