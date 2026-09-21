import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { BuildArtifacts } from "../../build-artifacts.js";
import { DiagnosticSink, Severity } from "../../diagnostic-sink.js";
import { EmptyPackageSource, libraryManifest } from "../../tests/fakes.js";
import type { BuildActionContext } from "../../build-action.js";
import { NpmArtifacts } from "../npm-artifacts.js";
import { GeneratePresentationAction } from "../generate-presentation-action.js";
import { FakePresentationBaker } from "../../../project-services/core/tests/fake-producer-seams.js";
import type { BakeOptions } from "../../../project-services/core/presentation-baker.js";
import type { CompiledPackage } from "../../../../publish/publish.js";

const OPTIONS: BakeOptions = { dictName: "LibraryPresentation", iconPrefix: "" };

function contextWith(pkg: CompiledPackage): BuildActionContext
{
    const artifacts = new BuildArtifacts();
    artifacts.Set(NpmArtifacts.CompiledModel, pkg);
    return {
        Project: new FakeStorage(),
        Sandbox: new FakeStorage(),
        Artifacts: artifacts,
        Source: new EmptyPackageSource(),
        Manifest: libraryManifest(),
        Options: {},
        Diagnostics: new DiagnosticSink(),
    };
}

function iconPkg(): CompiledPackage
{
    const iconNode = { id: "app1", type: "icon", attrs: { path: "visuals/a.svg" } };
    return {
        id: "microsoft",
        version: "1.0.0",
        document: { nodes: [iconNode], edges: [] },
        fullDocument: { nodes: [], edges: [] },
        sources: [],
        classes: [],
    } as unknown as CompiledPackage;
}

describe("GeneratePresentationAction", () =>
{
    test("bakes the compiled model's presentation through the injected baker", async () =>
    {
        const baker = new FakePresentationBaker({ ok: true, icons: 3 });
        const ctx = contextWith(iconPkg());

        await new GeneratePresentationAction(baker, OPTIONS).Execute(ctx);

        assert.equal(baker.calls.length, 1);
        assert.equal(baker.calls[0]!.options.dictName, "LibraryPresentation");
        assert.equal(ctx.Diagnostics.All().length, 0);
    });

    test("stamps resource keys onto the document so model.json carries them", async () =>
    {
        const pkg = iconPkg();
        const ctx = contextWith(pkg);

        await new GeneratePresentationAction(new FakePresentationBaker(), OPTIONS).Execute(ctx);

        const icon = pkg.document.nodes[0] as unknown as { attrs: Record<string, unknown> };
        assert.equal(typeof icon.attrs["key"], "string");
    });

    test("a missing icon is reported as an error diagnostic (blocks the build)", async () =>
    {
        const baker = new FakePresentationBaker({ ok: false, missing: ["visuals/a.svg"] });
        const ctx = contextWith(iconPkg());

        await new GeneratePresentationAction(baker, OPTIONS).Execute(ctx);

        const errors = ctx.Diagnostics.All().filter((d) => d.severity === Severity.Error);
        assert.equal(errors.length, 1);
        assert.match(errors[0]!.message, /a\.svg/);
    });
});
