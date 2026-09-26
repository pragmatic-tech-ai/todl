import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { DiagnosticSink, Severity } from "../../../build-system-core/diagnostic-sink.js";
import { EmptyPackageSource, libraryManifest } from "../../tests/fakes.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { NpmArtifacts } from "../npm-artifacts.js";
import { BakeResourcesAction } from "../bake-resources-action.js";
import { FakePresentationBaker } from "../../../project-services/core/tests/fake-producer-seams.js";
import type { CompiledPackage } from "../../../../publish/publish.js";

function metaModelManifest(): ProjectManifest
{
    return { type: ProjectType.MetaModel, name: "demo-mm", version: 1, id: "demo-mm" };
}

function architectureManifest(): ProjectManifest
{
    return { type: ProjectType.Architecture, name: "demo-arch", version: 1 };
}

function contextWith(pkg: CompiledPackage, manifest: ProjectManifest): TodlBuildContext
{
    const artifacts = new BuildArtifacts();
    artifacts.Set(NpmArtifacts.CompiledModel, pkg);
    return {
        Project: new FakeStorage(),
        Sandbox: new FakeStorage(),
        Artifacts: artifacts,
        Source: new EmptyPackageSource(),
        Manifest: manifest,
        Options: {},
        Diagnostics: new DiagnosticSink(),
    };
}

// A realistic own/full split (mirrors generate-presentation.test.ts's iconPkg fixture,
// before it was deleted): the entity + its `@icon` application + the Annotated edge
// between them are own (authored in-project), while the `icon`/`MuralResource`
// annotation declarations + the `Extends` edge between them live only in the closure —
// same as the real prelude.
function iconPkg(): CompiledPackage
{
    const entityNode = { id: "app1", type: null, metaKind: "concept", attrs: {} };
    const iconNode = { id: "app1@icon", type: "icon", metaKind: null, attrs: { path: "visuals/a.svg" } };
    const ownEdges = [{ kind: "Annotated", from: "app1", to: "app1@icon" }];
    const ownNodes = [entityNode, iconNode];
    return {
        id: "microsoft",
        version: "1.0.0",
        document: { nodes: ownNodes, edges: ownEdges },
        fullDocument: {
            nodes: [
                ...ownNodes,
                { id: "icon", type: null, metaKind: "annotation", attrs: {} },
                { id: "MuralResource", type: null, metaKind: "annotation", attrs: {} },
            ],
            edges: [...ownEdges, { kind: "Extends", from: "icon", to: "MuralResource" }],
        },
        sources: [],
        classes: [],
    } as unknown as CompiledPackage;
}

// No MuralResource-derived annotation applications at all — nothing for the emitter to
// detect, so DeclaresResources must gate the bake out entirely.
function plainPkg(): CompiledPackage
{
    const entityNode = { id: "app1", type: null, metaKind: "concept", attrs: {} };
    return {
        id: "microsoft",
        version: "1.0.0",
        document: { nodes: [entityNode], edges: [] },
        fullDocument: { nodes: [entityNode], edges: [] },
        sources: [],
        classes: [],
    } as unknown as CompiledPackage;
}

describe("BakeResourcesAction", () =>
{
    test("bakes when resources are declared and a baker is supplied", async () =>
    {
        const baker = new FakePresentationBaker();
        const ctx = contextWith(iconPkg(), libraryManifest());

        await new BakeResourcesAction(baker).Execute(ctx);

        assert.equal(baker.calls.length, 1);
        assert.equal(baker.calls[0]!.options.dictName, "LibraryPresentation");
        assert.equal(baker.calls[0]!.options.iconPrefix, "");
        assert.equal(ctx.Diagnostics.All().length, 0);
    });

    test("uses the meta-model dict name and icon prefix for a meta-model project", async () =>
    {
        const baker = new FakePresentationBaker();
        const ctx = contextWith(iconPkg(), metaModelManifest());

        await new BakeResourcesAction(baker).Execute(ctx);

        assert.equal(baker.calls.length, 1);
        assert.equal(baker.calls[0]!.options.dictName, "MetaModelPresentation");
        assert.equal(baker.calls[0]!.options.iconPrefix, "mm:");
    });

    test("skips cleanly (no error, no bake) when no baker is supplied", async () =>
    {
        const ctx = contextWith(iconPkg(), libraryManifest());

        await new BakeResourcesAction(undefined).Execute(ctx);

        assert.equal(ctx.Diagnostics.All().length, 0);
    });

    test("skips when the project declares no resources", async () =>
    {
        const baker = new FakePresentationBaker();
        const ctx = contextWith(plainPkg(), libraryManifest());

        await new BakeResourcesAction(baker).Execute(ctx);

        assert.equal(baker.calls.length, 0);
        assert.equal(ctx.Diagnostics.All().length, 0);
    });

    test("skips when the project type has no bake options (e.g. architecture)", async () =>
    {
        const baker = new FakePresentationBaker();
        const ctx = contextWith(iconPkg(), architectureManifest());

        await new BakeResourcesAction(baker).Execute(ctx);

        assert.equal(baker.calls.length, 0);
    });

    test("reports an Error diagnostic when the baker returns a missing-icons result", async () =>
    {
        const baker = new FakePresentationBaker({ ok: false, missing: ["visuals/a.svg"] });
        const ctx = contextWith(iconPkg(), libraryManifest());

        await new BakeResourcesAction(baker).Execute(ctx);

        const errors = ctx.Diagnostics.All().filter((d) => d.severity === Severity.Error);
        assert.equal(errors.length, 1);
        assert.match(errors[0]!.message, /a\.svg/);
    });

    test("is a no-op (no throw) when CompiledModel is absent", async () =>
    {
        const artifacts = new BuildArtifacts();
        const ctx: TodlBuildContext = {
            Project: new FakeStorage(),
            Sandbox: new FakeStorage(),
            Artifacts: artifacts,
            Source: new EmptyPackageSource(),
            Manifest: libraryManifest(),
            Options: {},
            Diagnostics: new DiagnosticSink(),
        };

        await assert.doesNotReject(async () => new BakeResourcesAction(new FakePresentationBaker()).Execute(ctx));
    });
});
