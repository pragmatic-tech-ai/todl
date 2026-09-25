import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ArtifactKey } from "../artifact-key.js";
import { StaticBuildFlavor } from "../build-flavor.js";
import type { CoreBuildContext, IBuildAction } from "../build-action.js";
import { NpmPackageBuildSystem } from "../../todl-build-system/npm/npm-package-build-system.js";
import { HtmlBundleBuildSystem } from "../../todl-build-system/html-bundle/html-bundle-build-system.js";

class NoopAction implements IBuildAction<CoreBuildContext>
{
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [];
    public readonly Produces: readonly ArtifactKey<unknown>[] = [];

    constructor(public readonly Name: string)
    {
    }

    public Execute(_ctx: CoreBuildContext): Promise<void>
    {
        return Promise.resolve();
    }
}

describe("StaticBuildFlavor", () =>
{
    test("exposes its id, display name, output name, and actions", () =>
    {
        const action = new NoopAction("compile");
        const flavor = new StaticBuildFlavor<CoreBuildContext>("npm-package", "npm package", "npm-package", [action]);
        assert.equal(flavor.Id, "npm-package");
        assert.equal(flavor.DisplayName, "npm package");
        assert.equal(flavor.OutputName, "npm-package");
        assert.deepEqual(flavor.Actions().map((a) => a.Name), ["compile"]);
    });

    test("defaults Requires to an empty list when the 5th argument is omitted", () =>
    {
        const action = new NoopAction("compile");
        const flavor = new StaticBuildFlavor<CoreBuildContext>("npm-package", "npm package", "npm-package", [action]);
        assert.deepEqual(flavor.Requires, []);
    });

    test("exposes the Requires list it was constructed with", () =>
    {
        const action = new NoopAction("compile");
        const requires = [{ Path: "generated/model.ts", GeneratorId: "model-dto" }];
        const flavor = new StaticBuildFlavor<CoreBuildContext>("npm-package", "npm package", "npm-package", [action], requires);
        assert.deepEqual(flavor.Requires, requires);
    });
});

describe("built-in systems expose a single flavor", () =>
{
    test("npm-package flavor mirrors the system output + non-empty pipeline", () =>
    {
        const flavors = new NpmPackageBuildSystem().Flavors();
        assert.equal(flavors.length, 1);
        assert.equal(flavors[0].OutputName, "npm-package");
        assert.ok(flavors[0].Actions().length > 0);
    });

    test("html-bundle flavor mirrors the system output + non-empty pipeline", () =>
    {
        const flavors = new HtmlBundleBuildSystem().Flavors();
        assert.equal(flavors.length, 1);
        assert.equal(flavors[0].OutputName, "html-bundle");
        assert.ok(flavors[0].Actions().length > 0);
    });
});
