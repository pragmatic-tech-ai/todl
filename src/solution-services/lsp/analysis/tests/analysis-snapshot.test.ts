import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalysisSnapshot } from "../analysis-snapshot.js";

test("AnalysisSnapshot exposes per-file AST + tokens, the model, refs, and diagnostics", () =>
{
    const a = AnalysisSnapshot.Build([{ uri: "d.todl", text: [
        "namespace demo {",
        "  concept animal { }",
        "  concept dog : animal { }",
        "}",
    ].join("\n") }]);
    assert.ok(a.Sources.get("d.todl")!.ast.declarations.length === 2);
    assert.ok(a.Sources.get("d.todl")!.tokens.length > 0);
    assert.ok(a.Model.has("demo.dog"));
    assert.equal(a.Refs.Get("animal").length, 1);
    assert.equal(a.Diagnostics.length, 0);
});

test("DiagnosticsByUri groups diagnostics per file and lists every source", () =>
{
    const a = AnalysisSnapshot.Build([
        { uri: "a.todl", text: "namespace demo {\n  primitive string { }\n  concept person { name : string; }\n  person alice { }\n}" },
        { uri: "b.todl", text: "namespace other {\n  concept clean { }\n}" },
    ]);
    // Every source file has an entry (empty for the clean one).
    assert.ok(a.DiagnosticsByUri.has("a.todl"));
    assert.ok(a.DiagnosticsByUri.has("b.todl"));
    assert.equal(a.DiagnosticsByUri.get("b.todl")!.length, 0);
    // The required-missing diagnostic is attributed to a.todl.
    assert.ok(a.DiagnosticsByUri.get("a.todl")!.length >= 1);
});

test("AnalysisSnapshot surfaces validation diagnostics for a missing required field", () =>
{
    // An unresolved *reference* is reported as reference.undefined by the loader,
    // which is distinct from a missing required scalar field (tested here).
    const a = AnalysisSnapshot.Build([{ uri: "d.todl", text: [
        "namespace demo {",
        "  primitive string { }",
        "  concept person { name : string; }",
        "  person alice { }",
        "}",
    ].join("\n") }]);
    assert.ok(a.Diagnostics.length >= 1);
});
