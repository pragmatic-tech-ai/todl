import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkedSource } from "./marked-fixture.js";
import { HoverProvider } from "../hover-provider.js";
import { CompletionProvider } from "../completion-provider.js";

test("hover on an instance lists its variants", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl", [
        "namespace demo {",
        "  concept report { label : string; }",
        "  concept board { relationship reads -> report; }",
        "  model m : demo {",
        "    report monthly { label = \"M\"; variant \"Nobody reads it.\"; }",
        "    board b { reads = month‸ly; }",
        "  }",
        "}",
    ].join("\n"));
    const hover = new HoverProvider().HoverAt(analysis, uri, positions[0]!);
    const value = (hover?.contents as { value: string }).value;
    assert.match(value, /Variants/);
    assert.match(value, /- Nobody reads it\./);
});

test("completion offers the variant keyword", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl", "namespace demo {\n  ‸\n}");
    const labels = new CompletionProvider().CompletionsAt(analysis, uri, positions[0]!).map((c) => c.label);
    assert.ok(labels.includes("variant"));
});
