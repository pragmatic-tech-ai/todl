import { test } from "node:test";
import assert from "node:assert/strict";

import { Graph, EdgeKind, Direction } from "../graph.js";

function node(id: string)
{
    return { id, tier: 2, type: "C", metaKind: null, namespace: "n", localId: id,
             isClass: false, class: null, storageId: null, canonicalId: null,
             fields: [], attrs: new Map() } as const;
}

test("removeEdge detaches an edge from both directions", () =>
{
    const g = new Graph();
    g.addNode(node("a") as never);
    g.addNode(node("b") as never);
    g.addEdge({ kind: EdgeKind.Relationship, via: "r", from: "a", to: "b" });
    assert.equal(g.related("a", EdgeKind.Relationship, Direction.Out, "r").length, 1);

    g.removeEdge(EdgeKind.Relationship, "r", "a", "b");

    assert.equal(g.related("a", EdgeKind.Relationship, Direction.Out, "r").length, 0);
    assert.equal(g.related("b", EdgeKind.Relationship, Direction.In, "r").length, 0);
});

test("removeEdge is a no-op when the edge is absent", () =>
{
    const g = new Graph();
    g.addNode(node("a") as never);
    assert.doesNotThrow(() => g.removeEdge(EdgeKind.Relationship, "r", "a", "zzz"));
});
