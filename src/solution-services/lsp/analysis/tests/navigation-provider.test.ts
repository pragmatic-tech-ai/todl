import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkedSource } from "./marked-fixture.js";
import { AnalysisSnapshot } from "../analysis-snapshot.js";
import { NavigationProvider } from "../navigation-provider.js";

const SRC = [
    "namespace demo {",       // line 0
    "  concept animal { }",   // line 1 — `animal` defined here
    "  concept dog : ani‸mal { }", // line 2 — reference (cursor here)
    "  animal a { }",         // line 3 — another reference (instance concept)
    "}",
].join("\n");

test("DefinitionAt jumps from a reference to the defining span", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl", SRC);
    const loc = new NavigationProvider().DefinitionAt(analysis, uri, positions[0]!);
    assert.equal(loc?.uri, "d.todl");
    assert.equal(loc?.range.start.line, 1);   // the `concept Animal` line (0-based)
});

test("ReferencesAt lists every occurrence, optionally including the definition", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl", SRC);
    const nav = new NavigationProvider();
    const refs = nav.ReferencesAt(analysis, uri, positions[0]!, false);
    assert.equal(refs.length, 2);             // the extends ref + the instance concept ref
    const withDecl = nav.ReferencesAt(analysis, uri, positions[0]!, true);
    assert.equal(withDecl.length, 3);         // + the definition
});

test("DefinitionAt jumps from a taxonomy `represents` target to the concept (cross-file)", () =>
{
    const concepts = "namespace demo.concepts {\n  concept actor { }\n}";
    // `taxonomy Actors : represents Actor` — the reference `actor` starts at col 31.
    const enums = "namespace demo.enums {\n  taxonomy actors : represents actor { }\n}";
    const analysis = AnalysisSnapshot.Build([{ uri: "concepts.todl", text: concepts }, { uri: "enums.todl", text: enums }]);
    const loc = new NavigationProvider().DefinitionAt(analysis, "enums.todl", { line: 1, character: 33 });
    assert.equal(loc?.uri, "concepts.todl");
    assert.equal(loc?.range.start.line, 1);   // the `concept Actor` line (0-based)
});
