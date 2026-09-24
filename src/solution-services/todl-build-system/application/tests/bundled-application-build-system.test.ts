import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BuildSystemRegistry } from "../../../build-system-core/build-system-registry.js";
import { ProjectType, type ProjectManifest } from "../../../package-manager/manifest.js";
import { BundledApplicationBuildSystem } from "../bundled-application-build-system.js";

function manifest(type: ProjectType): ProjectManifest
{
    return { type, name: "demo", version: 1, id: "demo" };
}

describe("BundledApplicationBuildSystem", () =>
{
    test("applies to architecture projects only", () =>
    {
        const sys = new BundledApplicationBuildSystem();
        assert.equal(sys.AppliesTo(manifest(ProjectType.Architecture)), true);
        assert.equal(sys.AppliesTo(manifest(ProjectType.Library)), false);
    });

    test("its flavor runs resolve -> compile -> generate, in order", () =>
    {
        const actions = new BundledApplicationBuildSystem().Flavors()[0]!.Actions();
        assert.deepEqual(actions.map((a) => a.Name), ["resolve-bases", "compile-model", "generate-model-package"]);
    });

    test("registers with consume-before-produce validation passing", () =>
    {
        const reg = new BuildSystemRegistry();
        assert.doesNotThrow(() => reg.Register(new BundledApplicationBuildSystem()));
    });
});
