import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalysisSnapshot } from "../analysis-snapshot.js";
import { CodeActionProvider } from "../code-action-provider.js";

test("offers to insert a missing required field on the instance", () =>
{
    const uri = "d.todl";
    const a = AnalysisSnapshot.Build([{ uri, text: [
        "namespace demo {",
        "  primitive string { }",
        "  concept person { name : string; }",
        "  person alice { }",
        "}",
    ].join("\n") }]);
    assert.ok(a.Diagnostics.length >= 1);
    const diagnostics = [...a.Diagnostics];
    const actions = new CodeActionProvider().CodeActions(a, uri, diagnostics[0]!.range, diagnostics);
    assert.equal(actions.length, 1);
    const edits = actions[0]!.edit!.changes![uri]!;
    assert.equal(edits.length, 1);
    assert.match(edits[0]!.newText, /name = /);
});

test("no actions when there are no fixable diagnostics", () =>
{
    const uri = "d.todl";
    const a = AnalysisSnapshot.Build([{ uri, text: "namespace demo {\n  concept a { }\n}" }]);
    assert.deepEqual(
        new CodeActionProvider().CodeActions(a, uri, { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, [...a.Diagnostics]),
        []);
});
