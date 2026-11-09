import { test } from "node:test";
import assert from "node:assert/strict";
import { SnapshotReader, Cypher } from "../index.js";

test("SnapshotReader is exported from the package root and reads a decoded $node cell", () =>
{
    const cell = { $node: { id: "n1", concept: "acme.Svc", label: "n1", fields: { name: { value: "a", definitionOrigin: "acme.Svc", valueOrigin: "self" } }, refs: {} } };
    const reader = new SnapshotReader(Cypher.CypherCellCodec.AsNode(cell)!);
    assert.equal(reader.id, "n1");
    assert.equal(reader.field("name"), "a");
});
