import { test } from "node:test";
import assert from "node:assert/strict";
import { ReferencedLabels } from "../referenced-labels.js";

test("extracts node labels from MATCH patterns", () =>
{
    const r = ReferencedLabels.Of("MATCH (w:Widget)-[:next]->(g:Gadget) RETURN w");
    assert.deepEqual([...r.labels].sort(), ["Gadget", "Widget"]);
    assert.equal(r.wildcard, false);
});

test("flags an unlabeled node pattern as wildcard", () =>
{
    const r = ReferencedLabels.Of("MATCH (n) RETURN n");
    assert.equal(r.wildcard, true);
    assert.deepEqual([...r.labels], []);
});

test("a syntactically invalid query yields wildcard (fail-safe: prefetch all)", () =>
{
    const r = ReferencedLabels.Of("MATCH (a RETURN");
    assert.equal(r.wildcard, true);
});
