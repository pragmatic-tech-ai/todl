import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MetadataSnapshot, type SeedGraph } from "../metadata-snapshot.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";
import type { ManifestJson } from "../../manifest/records.js";
import type { ReflectedNode } from "../../manifest/reflection/reflection.js";

// A manifest appears in `manifests` only once both PreRegister + Finalize have run.
function register(g: MetadataSnapshot, m: Manifest): void { g.PreRegister(m); g.Finalize(m); }

function soloManifest(model: string, concept: string): ManifestJson
{
    const logical: LogicalManifest = {
        format: "todl-manifest/1", model, version: "1.0.0", root: "Element",
        concepts: {
            Element: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
            [concept]: { extends: "Element", fields: { label: { type: "string", card: "?" } }, relationships: {}, invariants: [], annotations: [] },
        },
        classes: {}, taxonomies: {},
    };
    return ManifestWriter.fromLogical(logical).toJSON();
}

describe("MetadataSnapshot: registry + reflection + heap", () =>
{
    test("Register exposes the manifest via manifests/getManifest/getType", () =>
    {
        const g = new MetadataSnapshot();
        register(g, Manifest.load(soloManifest("shop", "Widget")));
        assert.deepEqual(g.manifests.map((m) => m.model), ["shop"]);
        assert.equal(g.getManifest("shop")?.model, "shop");
        assert.equal(g.getType("shop:Widget")?.name, "Widget");
    });

    test("BindSeed merges nodes and reflect() resolves via the owning manifest", () =>
    {
        const g = new MetadataSnapshot();
        register(g, Manifest.load(soloManifest("shop", "Widget")));
        const widget: ReflectedNode = { id: "w1", type: "Widget", namespace: "shop", attrs: { label: "Hi" } };
        g.BindSeed({ nodes: [widget] }, { model: "shop", version: "1.0.0" });
        assert.equal(g.heap.size, 1);
        const mirror = g.reflect(g.heap.getNode("w1")!);
        assert.equal(mirror.type.name, "Widget");
        assert.equal(mirror.field("label")!.value, "Hi");
    });

    test("BindSeed throws when a node's type is unknown", () =>
    {
        const g = new MetadataSnapshot();
        register(g, Manifest.load(soloManifest("shop", "Widget")));
        const bad: SeedGraph = { nodes: [{ id: "x", type: "Nope", attrs: {} }] };
        assert.throws(() => g.BindSeed(bad, { model: "shop", version: "1.0.0" }));
    });

    test("Evict removes only the nodes attributed to the given identity", () =>
    {
        const g = new MetadataSnapshot();
        register(g, Manifest.load(soloManifest("shop", "Widget")));
        g.BindSeed({ nodes: [{ id: "w1", type: "Widget", attrs: {} }] }, { model: "shop", version: "1.0.0" });
        g.BindSeed({ nodes: [{ id: "w2", type: "Widget", attrs: {} }] }, { model: "app", version: "9.9.9" });
        g.Evict("shop@1.0.0");
        assert.equal(g.heap.getNode("w1"), undefined);
        assert.equal(g.heap.getNode("w2")?.id, "w2");
        assert.equal(g.originOf("w2"), "app@9.9.9");
    });
});

test("a bare simple name shared by two manifests is ambiguous domain-wide; full names and unique names still resolve", () =>
{
    const g = new MetadataSnapshot();
    register(g, Manifest.load(soloManifest("a", "a.Widget")));
    register(g, Manifest.load(soloManifest("b", "b.Widget")));
    assert.equal(g.getType("Widget"), undefined);
    assert.equal(g.getType("a.Widget")?.fullName, "a.Widget");
    assert.equal(g.getType("b.Widget")?.fullName, "b.Widget");
    assert.equal(g.ownerOf("b.Widget")?.model, "b");
    assert.equal(g.getType("Element")?.fullName, "Element", "an exact full name wins even when several manifests declare it");
});
