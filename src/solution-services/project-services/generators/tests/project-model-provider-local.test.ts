import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import type { PackageRef } from "../../../../publish/publish.js";
import type { IPackageSource, SourcedPackage } from "../../../todl-build-system/package-source.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { toPackageJson } from "../../../package-manager/package-json.js";
import { ProjectModelProvider } from "../project-model-provider.js";
import type { ProjectModel } from "../project-content-generator.js";

class EmptySource implements IPackageSource
{
    public TryGet(_ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        return Promise.resolve(undefined);
    }
}

class LocalFixture
{
    public static readonly WidgetModel = "namespace acme { concept Widget { label : string?; } }";

    // A meta-model manifest with an id but NO packageVersion (an unpublished in-solution member).
    public static VersionlessManifest(): ProjectManifest
    {
        return { type: ProjectType.MetaModel, name: "Widgets", version: 1, id: "widgets" };
    }

    public static async Storage(): Promise<FakeStorage>
    {
        const storage = new FakeStorage();
        await storage.WriteText("model.todl", LocalFixture.WidgetModel);
        return storage;
    }

    public static NodeIds(model: ProjectModel): string[]
    {
        return (model.package?.document.nodes ?? []).map((n) => n.id);
    }
}

describe("ProjectModelProvider local (version-free) compile", () =>
{
    test("CompileLocal produces symbols for a member with no publishable version", async () =>
    {
        const provider = new ProjectModelProvider(await LocalFixture.Storage(), LocalFixture.VersionlessManifest(), new EmptySource());

        const model = await provider.CompileLocal();

        assert.equal(model.errors.length, 0, JSON.stringify(model.errors));
        assert.ok(model.package !== undefined, "a package/document is produced");
        assert.ok(LocalFixture.NodeIds(model).some((id) => id.endsWith("Widget")));
    });

    test("publish path still throws for the same version-less manifest", () =>
    {
        assert.throws(() => toPackageJson(LocalFixture.VersionlessManifest()), /has no publishable version/);
    });

    test("synthetic identity does not change symbols vs a versioned compile", async () =>
    {
        const storage = await LocalFixture.Storage();
        const local = await new ProjectModelProvider(storage, LocalFixture.VersionlessManifest(), new EmptySource()).CompileLocal();
        const versioned = await new ProjectModelProvider(
            storage, { ...LocalFixture.VersionlessManifest(), packageVersion: "1.2.3" }, new EmptySource()).CompileWithBases([]);

        assert.ok(LocalFixture.NodeIds(local).length > 0);
        assert.deepEqual(LocalFixture.NodeIds(local), LocalFixture.NodeIds(versioned));
    });

    test("CompileLocal reports unresolved base bindings as errors", async () =>
    {
        const manifest: ProjectManifest = { ...LocalFixture.VersionlessManifest(), metaModels: [{ id: "nope", version: "1.0.0" }] };
        const provider = new ProjectModelProvider(await LocalFixture.Storage(), manifest, new EmptySource());

        const model = await provider.CompileLocal();

        assert.equal(model.package, undefined);
        assert.ok(model.errors.length > 0);
    });
});
