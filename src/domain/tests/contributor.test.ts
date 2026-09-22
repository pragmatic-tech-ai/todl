import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BundledContributor } from "../contributor.js";
import type { ResolvedPackage } from "../domain.js";
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
