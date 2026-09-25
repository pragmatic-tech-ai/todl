import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { PackageRef, PackageResource } from "../../../../publish/publish.js";
import type { IPackageSource, SourcedPackage } from "../../../todl-build-system/package-source.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { ProjectModelProvider } from "../project-model-provider.js";

// A source that resolves nothing, mirroring the build-lifecycle smoke test's EmptySource:
// every binding falls through, so a project's bases can only come from wherever the test
// wires them (nowhere, here — both cases exercise no-bases behavior).
class EmptySource implements IPackageSource
{
    public TryGet(_ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        return Promise.resolve(undefined);
    }
}

const WIDGET_MODEL = "namespace acme { concept Widget { label : string?; } }";

function widgetManifest(): ProjectManifest
{
    return { type: ProjectType.MetaModel, name: "Widgets", version: 1, id: "widgets", packageVersion: "0.1.0" };
}

async function widgetProject(): Promise<FakeStorage>
{
    const storage = new FakeStorage();
    await storage.WriteText("project.plexus", JSON.stringify(widgetManifest()));
    await storage.WriteText("model.todl", WIDGET_MODEL);
    return storage;
}

describe("ProjectModelProvider", () =>
{
    test("Compile compiles a project's .todl sources into a CompiledPackage", async () =>
    {
        const project = await widgetProject();
        const provider = new ProjectModelProvider(project, widgetManifest(), new EmptySource());

        const model = await provider.Compile();

        assert.ok(model.package !== undefined, JSON.stringify(model.errors));
        assert.ok(model.package!.fullDocument.nodes.length > 0);
    });

    test("Compile reports errors when a declared base binding cannot be resolved", async () =>
    {
        const project = await widgetProject();
        const manifest: ProjectManifest = { ...widgetManifest(), metaModels: [{ id: "nope", version: "1.0.0" }] };
        const provider = new ProjectModelProvider(project, manifest, new EmptySource());

        const model = await provider.Compile();

        assert.equal(model.package, undefined);
        assert.ok(model.errors.length > 0);
    });
});
