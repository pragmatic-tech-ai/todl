import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkedSource } from "./marked-fixture.js";
import { CursorClassifier, ContextKind } from "../cursor-classifier.js";

test("classifies a reference occurrence as Identifier with its resolved symbol", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl",
        "namespace demo {\n  concept a { }\n  concept b : a‸ { }\n}");
    const ctx = CursorClassifier.ClassifyPosition(analysis, uri, positions[0]!);
    assert.equal(ctx.Kind, ContextKind.Identifier);
    assert.equal(ctx.Symbol, "a");
});

test("classifies a field-type slot after a colon", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl",
        "namespace demo {\n  concept a { name : ‸ }\n}");
    assert.equal(CursorClassifier.ClassifyPosition(analysis, uri, positions[0]!).Kind, ContextKind.TypeSlot);
});

test("classifies a relationship target slot after an arrow", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl",
        "namespace demo {\n  concept a { relationship r -> ‸ }\n}");
    assert.equal(CursorClassifier.ClassifyPosition(analysis, uri, positions[0]!).Kind, ContextKind.RelationshipTarget);
});

test("classifies a ref-value slot after an ampersand", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl",
        "namespace demo {\n  concept a { }\n  a x { }\n  a y { peer = &‸ }\n}");
    assert.equal(CursorClassifier.ClassifyPosition(analysis, uri, positions[0]!).Kind, ContextKind.RefValue);
});
