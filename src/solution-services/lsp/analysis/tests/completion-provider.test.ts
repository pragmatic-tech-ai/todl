import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkedSource } from "./marked-fixture.js";
import { CompletionProvider } from "../completion-provider.js";

class Labels
{
    public static Sorted(items: { label: string }[]): string[]
    {
        return items.map((i) => i.label).sort();
    }
}

test("a field-type slot offers concepts and primitives", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl", [
        "namespace demo {",
        "  primitive string { }",
        "  concept person { }",
        "  concept dog { owner : ‸ }",
        "}",
    ].join("\n"));
    const got = Labels.Sorted(new CompletionProvider().CompletionsAt(analysis, uri, positions[0]!));
    assert.ok(got.includes("string"));
    assert.ok(got.includes("person"));
});

test("a ref-value slot offers instances of the field's target concept", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl", [
        "namespace demo {",
        "  concept person { }",
        "  concept dog { relationship owner -> person []; }",
        "  person alice { }",
        "  person bob { }",
        "  dog rex { owner = &‸ }",
        "}",
    ].join("\n"));
    const got = Labels.Sorted(new CompletionProvider().CompletionsAt(analysis, uri, positions[0]!));
    assert.deepEqual(got, ["alice", "bob"]);
});

test("a ref-value slot narrows to the target concept's instances (and subtypes), not others", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl", [
        "namespace demo {",
        "  concept animal { }",
        "  concept dog : animal { }",
        "  concept person { }",
        "  concept owns { relationship pet -> animal []; }",
        "  animal generic { }",
        "  dog rex { }",
        "  person alice { }",
        "  owns o { pet = &‸ }",
        "}",
    ].join("\n"));
    const got = Labels.Sorted(new CompletionProvider().CompletionsAt(analysis, uri, positions[0]!));
    // animal + its subtype dog's instances — NOT the unrelated person `alice`.
    assert.deepEqual(got, ["generic", "rex"]);
});

test("top-level offers declaration keywords", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl",
        "namespace demo {\n  ‸\n}");
    const got = new CompletionProvider().CompletionsAt(analysis, uri, positions[0]!).map((i) => i.label);
    assert.ok(got.includes("concept"));
    assert.ok(got.includes("primitive"));
});
