import { test } from "node:test";
import assert from "node:assert/strict";
import { ManifestWriter } from "../manifest-writer.js";
import { Manifest } from "../reflection/reflection.js";
import type { LogicalManifest } from "../logical.js";

class NamespaceFixture
{
    public static Manifest(binary: boolean): Manifest
    {
        const empty = { fields: {}, relationships: {}, invariants: [], annotations: [] };
        const logical: LogicalManifest = {
            format: "todl-manifest/1", model: "m", version: "1.0.0", root: "Element",
            concepts: {
                Element: { extends: null, ...empty },
                "acme.Service": { extends: "Element", ...empty },
                "one.Dup": { extends: "Element", ...empty },
                "two.Dup": { extends: "Element", ...empty },
                Dup: { extends: "Element", ...empty },
            },
            classes: {}, taxonomies: {},
        };
        const writer = ManifestWriter.fromLogical(logical);
        return Manifest.load(binary ? writer.toBinary() : writer.toJSON());
    }
}

for (const binary of [false, true])
{
    test(`a namespaced concept round-trips as name + namespace (${binary ? "binary" : "json"})`, () =>
    {
        const m = NamespaceFixture.Manifest(binary);
        const svc = m.getType("acme.Service")!;
        assert.deepEqual([svc.name, svc.namespace, svc.fullName], ["Service", "acme", "acme.Service"]);
        assert.equal(m.getType("Service")?.fullName, "acme.Service", "a unique simple name resolves");
        const root = m.getType("Element")!;
        assert.deepEqual([root.name, root.namespace, root.fullName], ["Element", "", "Element"]);
    });
}

test("full names win over simple names, and an ambiguous simple name resolves to nothing", () =>
{
    const m = NamespaceFixture.Manifest(false);
    assert.equal(m.getType("Dup")?.fullName, "Dup", "the un-namespaced Dup is an exact full-name match");
    assert.equal(m.getType("one.Dup")?.fullName, "one.Dup");
    assert.equal(m.getType("two.Dup")?.fullName, "two.Dup");
});
