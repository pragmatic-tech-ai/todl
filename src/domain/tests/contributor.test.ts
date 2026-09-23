import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BundledContributor, PackagesContributor } from "../contributor.js";
import { MemoryPackageSource } from "../memory-package-source.js";
import { MemoryResourceSource } from "../memory-resource-source.js";
import type { ResolvedPackage, PackageSource, PackageRef } from "../domain.js";
import type { ResourceSource } from "../resource-source.js";
import type { ResourceContent } from "../contributor.js";
import type { ManifestJson } from "../../manifest/records.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";

function soloManifest(model: string, concept: string): ManifestJson
{
    const logical: LogicalManifest = {
        format: "todl-manifest/1", model, version: "1.0.0", root: "Element",
        concepts: {
            Element: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
            [concept]: { extends: "Element", fields: {}, relationships: {}, invariants: [], annotations: [] },
        },
        classes: {}, taxonomies: {},
    };
    return ManifestWriter.fromLogical(logical).toJSON();
}

function pkg(model: string): ResolvedPackage
{
    return { ref: { model, version: "1.0.0" }, manifest: soloManifest(model, "Widget"), dependencies: [] };
}

describe("BundledContributor", () =>
{
    test("maps inlined packages to contributions and exposes roots", async () =>
    {
        const roots = [{ model: "acme.lib", version: "1.0.0" }];
        const c = new BundledContributor([pkg("acme.meta"), pkg("acme.lib")], roots);
        assert.deepEqual([...c.Roots], roots);
        const contributions = await c.Contributions();
        assert.deepEqual(contributions.map((x) => x.identity.model).sort(), ["acme.lib", "acme.meta"]);
        assert.equal(contributions[0]!.identity.version, "1.0.0");
    });

    test("Resource returns undefined (no asset store yet)", async () =>
    {
        const c = new BundledContributor([pkg("acme.meta")], []);
        assert.equal(await c.Resource("resources/x.svg"), undefined);
    });
});

function dep(model: string, deps: { model: string; version: string }[]): ResolvedPackage
{
    return { ref: { model, version: "1.0.0" }, manifest: soloManifest(model, "Widget"), dependencies: deps };
}

describe("PackagesContributor", () =>
{
    test("resolves a deps-first, deduped closure from its sources", async () =>
    {
        // a → b, c → b (diamond): b appears once, before a and c.
        const source = new MemoryPackageSource([
            dep("b", []),
            dep("a", [{ model: "b", version: "1.0.0" }]),
            dep("c", [{ model: "b", version: "1.0.0" }]),
        ]);
        const c = new PackagesContributor([source], [
            { model: "a", version: "1.0.0" },
            { model: "c", version: "1.0.0" },
        ]);
        const ids = (await c.Contributions()).map((x) => x.identity.model);
        assert.deepEqual(ids, ["b", "a", "c"]); // deps-first, b deduped
    });

    test("pins an unversioned root via the source's versions()", async () =>
    {
        const source = new MemoryPackageSource([dep("solo", [])]);
        const c = new PackagesContributor([source], [{ model: "solo" }]);
        const contributions = await c.Contributions();
        assert.equal(contributions[0]!.identity.version, "1.0.0");
    });
});

describe("Contributor resources", () =>
{
    test("BundledContributor resolves via an injected ResourceSource", async () =>
    {
        const res = new MemoryResourceSource([["acme.meta/1.0.0/resources/a.svg", new Uint8Array([7])]]);
        const c = new BundledContributor([pkg("acme.meta")], [], res);
        assert.deepEqual((await c.Resource("acme.meta/1.0.0/resources/a.svg"))!.bytes, new Uint8Array([7]));
    });

    test("BundledContributor with no injected source resolves nothing", async () =>
    {
        const c = new BundledContributor([pkg("acme.meta")], []);
        assert.equal(await c.Resource("acme.meta/1.0.0/resources/a.svg"), undefined);
    });

    test("PackagesContributor resolves resources through its sources", async () =>
    {
        // A source that both resolves packages and serves one resource.
        class FakeSource implements PackageSource, ResourceSource
        {
            constructor(private readonly res: MemoryResourceSource) {}
            resolve(ref: PackageRef): Promise<ResolvedPackage>
            {
                return Promise.resolve(dep(ref.model, []));
            }
            resource(uri: string): Promise<ResourceContent | undefined>
            {
                return this.res.resource(uri);
            }
        }
        const res = new MemoryResourceSource([["solo/1.0.0/resources/b.png", new Uint8Array([5])]]);
        const c = new PackagesContributor([new FakeSource(res)], [{ model: "solo", version: "1.0.0" }]);
        assert.deepEqual((await c.Resource("solo/1.0.0/resources/b.png"))!.bytes, new Uint8Array([5]));
        assert.equal(await c.Resource("solo/1.0.0/resources/missing.png"), undefined);
    });
});
