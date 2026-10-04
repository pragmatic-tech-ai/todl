import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalysisSnapshot } from "../analysis-snapshot.js";
import { WorkspaceSymbolProvider } from "../workspace-symbol-provider.js";

test("matches symbols by case-insensitive substring", () =>
{
    const a = AnalysisSnapshot.Build([{ uri: "d.todl", text: [
        "namespace demo {",
        "  concept person { }",
        "  concept product { }",
        "  person alice { }",
        "}",
    ].join("\n") }]);
    const provider = new WorkspaceSymbolProvider();
    const names = provider.Query(a, "per").map((s) => s.name).sort();
    assert.deepEqual(names, ["person"]);
    assert.deepEqual(provider.Query(a, "p").map((s) => s.name).sort(), ["person", "product"]);
    // Location points into the file.
    assert.equal(provider.Query(a, "person")[0]!.location.uri, "d.todl");
});

test("an empty query returns every symbol", () =>
{
    const a = AnalysisSnapshot.Build([{ uri: "d.todl", text: "namespace demo {\n  concept a { }\n}" }]);
    assert.equal(new WorkspaceSymbolProvider().Query(a, "").length, 1);
});
