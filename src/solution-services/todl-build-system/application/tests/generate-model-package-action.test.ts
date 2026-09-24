import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { DiagnosticSink, Severity } from "../../../build-system-core/diagnostic-sink.js";
import { EmptyPackageSource } from "../../tests/fakes.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { NpmArtifacts } from "../../npm/npm-artifacts.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import type { CompiledPackage } from "../../../../publish/publish.js";
import { GenerateModelPackageAction } from "../generate-model-package-action.js";

// Single application model with explicit entrypoint; model id "core" emits bare.
const APP_SOURCE = `
namespace a {
  concept service { name : string; }
  model core : a {
    annotate entrypoint { }
    service api { name = "API"; }
  }
}
`;

// Library — no model, so ApplicationRootResolver.Resolve returns undefined and
// ModelPackageGenerator.Generate throws → the action reports a diagnostic.
const LIB_SOURCE = `
namespace a {
  concept service { name : string; }
}
`;

function manifest(id: string): ProjectManifest
{
    return { type: ProjectType.Architecture, name: id, version: 1, id };
}

function gate(id: string): CompiledPackage
{
    return { id, version: "0.0.0", document: { nodes: [], edges: [] }, fullDocument: { nodes: [], edges: [] }, sources: [], classes: [] } as unknown as CompiledPackage;
}

async function contextWith(id: string, source: string): Promise<{ ctx: TodlBuildContext; sandbox: FakeStorage }>
{
    const project = new FakeStorage();
    // Write the .todl source as npm-build.test.ts does: a single "model.todl" file.
    await project.WriteText("model.todl", source);
    const sandbox = new FakeStorage();
    const artifacts = new BuildArtifacts();
    artifacts.Set(NpmArtifacts.CompiledModel, gate(id));
    artifacts.Set(NpmArtifacts.ResolvedBases, []);
    const ctx: TodlBuildContext = {
        Project: project,
        Sandbox: sandbox,
        Artifacts: artifacts,
        Source: new EmptyPackageSource(),
        Manifest: manifest(id),
        Options: {},
        Diagnostics: new DiagnosticSink(),
    };
    return { ctx, sandbox };
}

describe("GenerateModelPackageAction", () =>
{
    test("stages <id>.package.generated.ts with the registry factory", async () =>
    {
        const { ctx, sandbox } = await contextWith("demo-app", APP_SOURCE);
        await new GenerateModelPackageAction().Execute(ctx);

        assert.equal(ctx.Diagnostics.All().filter((d) => d.severity === Severity.Error).length, 0);
        const text = await sandbox.ReadText("demo-app.package.generated.ts");
        assert.match(text, /export class AppRegistry/);
        assert.match(text, /registry\.SetRoot\("core"\)/);
    });

    test("a non-application project is reported as an error diagnostic (no crash)", async () =>
    {
        const { ctx, sandbox } = await contextWith("demo-lib", LIB_SOURCE);
        await new GenerateModelPackageAction().Execute(ctx);

        const errors = ctx.Diagnostics.All().filter((d) => d.severity === Severity.Error);
        assert.equal(errors.length, 1);
        assert.equal(await sandbox.Exists("demo-lib.package.generated.ts"), false);
    });

    test("a missing compiled model is reported (no crash)", async () =>
    {
        const project = new FakeStorage();
        const ctx: TodlBuildContext = {
            Project: project, Sandbox: new FakeStorage(), Artifacts: new BuildArtifacts(),
            Source: new EmptyPackageSource(), Manifest: manifest("x"), Options: {}, Diagnostics: new DiagnosticSink(),
        };
        await new GenerateModelPackageAction().Execute(ctx);
        assert.equal(ctx.Diagnostics.All().filter((d) => d.severity === Severity.Error).length, 1);
    });
});
