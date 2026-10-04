import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkedSource } from "./marked-fixture.js";
import { RenameProvider } from "../rename-provider.js";

const SRC = [
    "namespace demo {",
    "  concept ani‸mal { }",     // definition (cursor here)
    "  concept dog : animal { }", // reference
    "  animal a { }",             // reference (instance concept)
    "}",
].join("\n");

test("PrepareRename returns the identifier range at the cursor", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl", SRC);
    const range = new RenameProvider().PrepareRename(analysis, uri, positions[0]!);
    assert.deepEqual(range, { start: { line: 1, character: 10 }, end: { line: 1, character: 16 } });
});

test("RenameEdits rewrites the definition and every reference", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl", SRC);
    const edit = new RenameProvider().RenameEdits(analysis, uri, positions[0]!, "creature");
    assert.ok(!("Error" in edit));
    const edits = (edit as { changes: Record<string, unknown[]> }).changes["d.todl"]!;
    assert.equal(edits.length, 3);   // definition + 2 references
});

test("RenameEdits rejects an invalid name", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl", SRC);
    const bad = new RenameProvider().RenameEdits(analysis, uri, positions[0]!, "Animal");   // not kebab-case
    assert.ok("Error" in bad);
});

test("RenameEdits rejects a colliding name", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl", SRC);
    const clash = new RenameProvider().RenameEdits(analysis, uri, positions[0]!, "dog");   // already defined
    assert.ok("Error" in clash);
});
