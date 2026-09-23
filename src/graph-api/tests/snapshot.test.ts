import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Snapshot } from "../snapshot.js";
import { FrozenGraph } from "../../domain/graph.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";
import type { ManifestJson } from "../../manifest/records.js";
import type { ReflectedNode } from "../../manifest/reflection/reflection.js";

// A manifest with Element -> Widget { label:string?, size:number? }, self-relationship links:[Widget].
function widgetManifest(): ManifestJson
{
    const logical: LogicalManifest = {
        format: "todl-manifest/1", model: "shop", version: "1.0.0", root: "Element",
        concepts: {
            Element: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
            Widget: {
                extends: "Element",
                fields: { label: { type: "string", card: "?" }, size: { type: "number", card: "?" } },
                relationships: { links: { targets: ["Widget"], card: "*", annotations: [] } },
                invariants: [], annotations: [],
            },
        },
        classes: {}, taxonomies: {},
    };
    return ManifestWriter.fromLogical(logical).toJSON();
}

function graph(nodes: ReflectedNode[], edges: { from: string; rel: string; to: string }[] = []): FrozenGraph
{
    const g = new FrozenGraph();
    const m = Manifest.load(widgetManifest());
    g.PreRegister(m); g.Finalize(m);
    g.BindSeed({ nodes, edges }, { model: "shop", version: "1.0.0" });
    return g;
}

describe("Snapshot.of (instance)", () =>
{
    test("projects id, concept, label and fields with origins", () =>
    {
        const g = graph([{ id: "w1", type: "Widget", attrs: { label: "Hello", size: 3 } }]);
        const snap = Snapshot.of(g.reflect(g.getNode("w1")!));
        assert.equal(snap.id, "w1");
        assert.equal(snap.concept, "Widget");
        assert.equal(snap.label, "Hello");
        assert.equal(snap.fields.label!.value, "Hello");
        assert.equal(snap.fields.label!.definitionOrigin, "Widget");
        assert.equal(snap.fields.label!.valueOrigin, "self");
    });

    test("refs are shallow target-id lists; label falls back to id", () =>
    {
        const g = graph(
            [{ id: "w1", type: "Widget", attrs: {} }, { id: "w2", type: "Widget", attrs: {} }],
            [{ from: "w1", rel: "links", to: "w2" }],
        );
        const snap = Snapshot.of(g.reflect(g.getNode("w1")!));
        assert.deepEqual(snap.refs.links, ["w2"]);
        assert.equal(snap.label, "w1"); // no label/name attr
    });
});

describe("Snapshot.ofType", () =>
{
    test("projects fields, relationships, extends and kind", () =>
    {
        const g = graph([]);
        const snap = Snapshot.ofType(g.getType("shop:Widget")!);
        assert.equal(snap.name, "Widget");
        assert.equal(snap.extends, "Element");
        assert.equal(snap.kind, "Concept");
        assert.deepEqual(snap.fields.map((f) => f.name).sort(), ["label", "size"]);
        assert.deepEqual(snap.relationships.map((r) => r.name), ["links"]);
        assert.deepEqual(snap.relationships[0]!.targets, ["Widget"]);
    });
});
