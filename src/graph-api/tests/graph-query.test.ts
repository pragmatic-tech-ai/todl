import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GraphQuery } from "../graph-query-engine.js";
import { FrozenGraph } from "../../domain/graph.js";
import { Manifest } from "../../manifest/reflection/reflection.js";
import { ManifestWriter } from "../../manifest/manifest-writer.js";
import type { LogicalManifest } from "../../manifest/logical.js";
import type { ManifestJson } from "../../manifest/records.js";
import type { ReflectedNode } from "../../manifest/reflection/reflection.js";

function register(g: FrozenGraph, m: Manifest): void { g.PreRegister(m); g.Finalize(m); }

// Element -> Widget(label?, links:[Widget]) -> SuperWidget.
function widgetManifest(model: string): ManifestJson
{
    const logical: LogicalManifest = {
        format: "todl-manifest/1", model, version: "1.0.0", root: "Element",
        concepts: {
            Element: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
            Widget: {
                extends: "Element",
                fields: { label: { type: "string", card: "?" } },
                relationships: { links: { targets: ["Widget"], card: "*", annotations: [] } },
                invariants: [], annotations: [],
            },
            SuperWidget: { extends: "Widget", fields: {}, relationships: {}, invariants: [], annotations: [] },
        },
        classes: {}, taxonomies: {},
    };
    return ManifestWriter.fromLogical(logical).toJSON();
}

// Component with a two-level taxonomy Comp: Surface -> Card.
function taxonomyManifest(): ManifestJson
{
    const logical: LogicalManifest = {
        format: "todl-manifest/1", model: "ui", version: "1.0.0", root: "Element",
        concepts: {
            Element: { extends: null, fields: {}, relationships: {}, invariants: [], annotations: [] },
            Component: { extends: "Element", fields: {}, relationships: {}, invariants: [], annotations: [] },
        },
        classes: {
            "Comp.Surface": { concept: "Component", taxonomy: "Comp", narrower: ["Comp.Card"], fixed: {}, annotations: [] },
            "Comp.Card": { concept: "Component", taxonomy: "Comp", broader: "Comp.Surface", narrower: [], fixed: {}, annotations: [] },
        },
        taxonomies: { Comp: { represents: ["Component"], roots: ["Comp.Surface"] } },
    };
    return ManifestWriter.fromLogical(logical).toJSON();
}

function widgetGraph(nodes: ReflectedNode[], edges: { from: string; rel: string; to: string }[] = []): FrozenGraph
{
    const g = new FrozenGraph();
    register(g, Manifest.load(widgetManifest("shop")));
    g.BindSeed({ nodes, edges }, { model: "shop", version: "1.0.0" });
    return g;
}

describe("GraphQuery: concepts + instances", () =>
{
    test("Concepts lists concept types across manifests, deduped by fullName", () =>
    {
        const g = new FrozenGraph();
        register(g, Manifest.load(widgetManifest("shop")));
        register(g, Manifest.load(taxonomyManifest()));
        // TypeInfo.fullName is manifest-local (no model qualifier); dedup is by that name.
        const names = new GraphQuery(g).Concepts().map((t) => t.fullName).sort();
        assert.deepEqual(names, ["Component", "SuperWidget", "Widget"]);
    });

    test("InstancesOf returns a concept's instances AND its subtypes", () =>
    {
        const g = widgetGraph([
            { id: "w1", type: "Widget", attrs: { label: "One" } },
            { id: "s1", type: "SuperWidget", attrs: {} },
        ]);
        const ids = new GraphQuery(g).InstancesOf("Widget").map((m) => m.node.id).sort();
        assert.deepEqual(ids, ["s1", "w1"]);
        const supers = new GraphQuery(g).InstancesOf("SuperWidget").map((m) => m.node.id);
        assert.deepEqual(supers, ["s1"]);
    });

    test("Reflect returns a mirror; undefined for an unknown id", () =>
    {
        const g = widgetGraph([{ id: "w1", type: "Widget", attrs: { label: "One" } }]);
        const q = new GraphQuery(g);
        assert.equal(q.Reflect("w1")!.type.name, "Widget");
        assert.equal(q.Reflect("nope"), undefined);
    });
});

describe("GraphQuery: refs + search", () =>
{
    test("Refs follows a member; Referrers inverts it (with optional member filter)", () =>
    {
        const g = widgetGraph(
            [{ id: "w1", type: "Widget", attrs: {} }, { id: "w2", type: "Widget", attrs: {} }],
            [{ from: "w1", rel: "links", to: "w2" }],
        );
        const q = new GraphQuery(g);
        assert.deepEqual(q.Refs("w1", "links").map((m) => m.node.id), ["w2"]);
        assert.deepEqual(q.Referrers("w2").map((m) => m.node.id), ["w1"]);
        assert.deepEqual(q.Referrers("w2", "links").map((m) => m.node.id), ["w1"]);
        assert.deepEqual(q.Referrers("w2", "other"), []);
    });

    test("Search matches label and id, case-insensitively", () =>
    {
        const g = widgetGraph([
            { id: "w1", type: "Widget", attrs: { label: "Hello" } },
            { id: "gadget", type: "Widget", attrs: {} },
        ]);
        const q = new GraphQuery(g);
        assert.deepEqual(q.Search("hell").map((m) => m.node.id), ["w1"]);
        assert.deepEqual(q.Search("GADGET").map((m) => m.node.id), ["gadget"]);
    });
});

describe("GraphQuery: taxonomy", () =>
{
    test("Narrower/Broader/Descendants/Ancestors walk the taxonomy", () =>
    {
        const g = new FrozenGraph();
        register(g, Manifest.load(taxonomyManifest()));
        const q = new GraphQuery(g);
        assert.equal(q.Term("Comp.Surface")?.id, "Comp.Surface");
        assert.deepEqual(q.Narrower("Comp.Surface").map((t) => t.id), ["Comp.Card"]);
        assert.deepEqual(q.Broader("Comp.Card").map((t) => t.id), ["Comp.Surface"]);
        assert.deepEqual(q.Descendants("Comp.Surface").map((t) => t.id), ["Comp.Card"]);
        assert.deepEqual(q.Ancestors("Comp.Card").map((t) => t.id), ["Comp.Surface"]);
    });
});
