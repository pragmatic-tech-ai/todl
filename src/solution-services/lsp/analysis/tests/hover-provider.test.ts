import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkedSource } from "./marked-fixture.js";
import { HoverProvider } from "../hover-provider.js";

test("hover on a concept reference shows its kind and name", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl",
        "namespace demo {\n  concept animal { }\n  concept dog : ani‸mal { }\n}");
    const hover = new HoverProvider().HoverAt(analysis, uri, positions[0]!);
    const value = (hover?.contents as { value: string }).value;
    assert.match(value, /concept/);
    assert.match(value, /animal/);
});

test("hover off any symbol is null", () =>
{
    const { analysis, positions, uri } = MarkedSource.Fixture("d.todl",
        "namespace demo {‸\n  concept a { }\n}");
    assert.equal(new HoverProvider().HoverAt(analysis, uri, positions[0]!), null);
});
