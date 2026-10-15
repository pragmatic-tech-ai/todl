import { test } from "node:test";
import assert from "node:assert/strict";
import { ReferencedLabels } from "../referenced-labels.js";

test("extracts node labels from MATCH patterns", () =>
{
    const r = ReferencedLabels.Of("MATCH (w:Widget)-[:next]->(g:Gadget) RETURN w");
    assert.deepEqual([...r.labels].sort(), ["Gadget", "Widget"]);
    assert.equal(r.wildcard, false);
    assert.equal(r.parseFailed, false);
});

test("flags an unlabeled node pattern as wildcard", () =>
{
    const r = ReferencedLabels.Of("MATCH (n) RETURN n");
    assert.equal(r.wildcard, true);
    assert.equal(r.parseFailed, false);
    assert.deepEqual([...r.labels], []);
});

test("a syntactically invalid query reports parseFailed, not wildcard (prefetch nothing)", () =>
{
    const r = ReferencedLabels.Of("MATCH (a RETURN");
    assert.equal(r.parseFailed, true);
    assert.equal(r.wildcard, false);
    assert.deepEqual([...r.labels], []);
});

test("covers OPTIONAL MATCH and mixed labeled/unlabeled across clauses", () =>
{
    const r = ReferencedLabels.Of("MATCH (a:A) OPTIONAL MATCH (a)-[:next]->(b) RETURN a");
    assert.deepEqual([...r.labels], ["A"]);
    assert.equal(r.wildcard, true);
    assert.equal(r.parseFailed, false);
});
