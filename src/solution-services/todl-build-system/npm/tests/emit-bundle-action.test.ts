import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../../build-system-core/build-artifacts.js";
import { DiagnosticSink, Severity } from "../../../build-system-core/diagnostic-sink.js";
import { EmptyPackageSource } from "../../tests/fakes.js";
import type { TodlBuildContext } from "../../todl-build-context.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { NpmArtifacts } from "../npm-artifacts.js";
import { EmitBundleAction } from "../emit-bundle-action.js";
import { compilePackage } from "../../../../publish/publish.js";
import type { CompiledPackage } from "../../../../publish/publish.js";
import type { SourceFile } from "../../../../compiler-services/diagnostics/span.js";
import type { PackageBundle } from "../../../project-services/core/package-bundle.js";

// A minimal taxonomy source with exactly one instantiable class (`class=true` Instance
// clabject) — enough for `compilePackage` to produce a real `PublishedClass` in
// `pkg.classes`, so the test exercises the actual derive/scan path rather than a
// hand-rolled fixture. Also authors a package-level annotation application (`package {
// annotate Author { ... } }`) so the fix under test — reading the reserved package-node
// id from the shared `PACKAGE_NODE_ID` constant rather than a private duplicate — is
// covered end to end: `projectAnnotations` must still find it.
const CLASS_SRC: SourceFile = {
    uri: "model.todl",
    text: `namespace acme {
        annotation Author { name : string; }
        package { annotate Author { name = "Acme"; } }
        concept Location { label : string; }
        taxonomy Regions : represents Location {
            Location euWest { label = "EU West"; }
        }
    }`,
};

function metaModelManifest(): ProjectManifest
{
    return { type: ProjectType.MetaModel, name: "demo-mm", version: 1, id: "demo-mm", packageVersion: "1.0.0" };
}

function libraryManifest(): ProjectManifest
{
    return { type: ProjectType.Library, name: "demo-lib", version: 1, id: "demo-lib", packageVersion: "1.0.0" };
}

function architectureManifest(): ProjectManifest
{
    return { type: ProjectType.Architecture, name: "demo-arch", version: 1 };
}

function compiledPackage(id: string): CompiledPackage
{
    const outcome = compilePackage([], [CLASS_SRC], { id, version: "1.0.0" });
    assert.ok(outcome.ok && outcome.package !== undefined, JSON.stringify(outcome.errors));
    return outcome.package!;
}

function contextWith(pkg: CompiledPackage | undefined, manifest: ProjectManifest, project = new FakeStorage()): TodlBuildContext
{
    const artifacts = new BuildArtifacts();
    if (pkg !== undefined) artifacts.Set(NpmArtifacts.CompiledModel, pkg);
    return {
        Project: project,
        Sandbox: new FakeStorage(),
        Artifacts: artifacts,
        Source: new EmptyPackageSource(),
        Manifest: manifest,
        Options: {},
        Diagnostics: new DiagnosticSink(),
    };
}

describe("EmitBundleAction", () =>
{
    test("meta-model project: writes bundle.json with type 'meta-model' and the derived classes", async () =>
    {
        const pkg = compiledPackage("demo-mm");
        const ctx = contextWith(pkg, metaModelManifest());

        await new EmitBundleAction().Execute(ctx);

        assert.equal(await ctx.Sandbox.Exists("bundle.json"), true);
        const bundle = JSON.parse(await ctx.Sandbox.ReadText("bundle.json")) as PackageBundle;
        assert.equal(bundle.type, "meta-model");
        assert.equal(bundle.id, "demo-mm");
        assert.equal(bundle.version, "1.0.0");
        assert.ok(bundle.classes.length > 0, "at least one derived class");
        assert.ok(bundle.classes.some((c) => c.localId === "euWest"));
        // Package-level annotations still populate — the reserved package-node id now
        // comes from the shared `PACKAGE_NODE_ID` constant (kinds.ts), not a private copy.
        assert.deepEqual(bundle.annotations["acme.Author"], { name: "Acme" });
    });

    test("library project: writes bundle.json with type 'library'", async () =>
    {
        const pkg = compiledPackage("demo-lib");
        const ctx = contextWith(pkg, libraryManifest());

        await new EmitBundleAction().Execute(ctx);

        assert.equal(await ctx.Sandbox.Exists("bundle.json"), true);
        const bundle = JSON.parse(await ctx.Sandbox.ReadText("bundle.json")) as PackageBundle;
        assert.equal(bundle.type, "library");
        assert.equal(bundle.id, "demo-lib");
    });

    test("attaches scanned resource files (visuals/thumbnails/docs) to their matching class", async () =>
    {
        const pkg = compiledPackage("demo-lib");
        const classId = pkg.classes[0]!.id;
        const project = new FakeStorage();
        await project.WriteText(`visuals/${classId}.mural`, "<mural/>");
        await project.WriteText(`thumbnails/${classId}.png`, "PNG");
        await project.WriteText(`docs/${classId}.md`, "# doc");
        const ctx = contextWith(pkg, libraryManifest(), project);

        await new EmitBundleAction().Execute(ctx);

        const bundle = JSON.parse(await ctx.Sandbox.ReadText("bundle.json")) as PackageBundle;
        const cls = bundle.classes.find((c) => c.id === classId);
        assert.equal(cls?.template, `visuals/${classId}.mural`);
        assert.equal(cls?.thumbnail, `thumbnails/${classId}.png`);
        assert.equal(cls?.doc, `docs/${classId}.md`);
        assert.deepEqual(bundle.docs, [`docs/${classId}.md`]);
    });

    test("an orphan visual is reported as a non-blocking Warning and the bundle is still written", async () =>
    {
        const pkg = compiledPackage("demo-lib");
        const project = new FakeStorage();
        await project.WriteText("visuals/ghost.mural", "<mural/>");
        const ctx = contextWith(pkg, libraryManifest(), project);

        await new EmitBundleAction().Execute(ctx);

        const diagnostics = ctx.Diagnostics.All();
        assert.equal(diagnostics.length, 1);
        assert.equal(diagnostics[0]?.severity, Severity.Warning);
        assert.match(diagnostics[0]?.message ?? "", /visuals\/ghost\.mural/);
        assert.equal(ctx.Diagnostics.HasErrorsSince(0), false, "an orphan never blocks the build");
        assert.equal(await ctx.Sandbox.Exists("bundle.json"), true);
    });

    test("architecture project: no bundle.json written, no throw", async () =>
    {
        const pkg = compiledPackage("demo-arch");
        const ctx = contextWith(pkg, architectureManifest());

        await assert.doesNotReject(async () => new EmitBundleAction().Execute(ctx));

        assert.equal(await ctx.Sandbox.Exists("bundle.json"), false);
    });

    test("no CompiledModel artifact: no write, no throw", async () =>
    {
        const ctx = contextWith(undefined, libraryManifest());

        await assert.doesNotReject(async () => new EmitBundleAction().Execute(ctx));

        assert.equal(await ctx.Sandbox.Exists("bundle.json"), false);
    });
});
