import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../../../compiler-services/parse/parser.js";
import { DefinitionIndex } from "../definition-index.js";
import { SymbolKind } from "../symbol-kinds.js";

class IndexFixture
{
    public static DefsOf(src: string, uri = "d.todl"): DefinitionIndex
    {
        return DefinitionIndex.Build(new Map([[uri, parse(src, uri).namespace]]));
    }
}

test("indexes each definition's name range and kind", () =>
{
    const defs = IndexFixture.DefsOf([
        "namespace demo {",
        "  primitive string { }",
        "  concept person { }",
        "  person alice { }",
        "}",
    ].join("\n"));
    assert.equal(defs.Get("person")?.Kind, SymbolKind.Concept);
    assert.equal(defs.Get("string")?.Kind, SymbolKind.Primitive);
    assert.equal(defs.Get("alice")?.Kind, SymbolKind.Instance);
    // `person` name is on 0-based line 2, characters 10..16.
    assert.deepEqual(defs.Get("person")?.NameRange, {
        start: { line: 2, character: 10 }, end: { line: 2, character: 16 },
    });
});

test("DefinitionAt resolves a position on a definition name", () =>
{
    const defs = IndexFixture.DefsOf("namespace demo {\n  concept person { }\n}");
    const hit = defs.DefinitionAt("d.todl", { line: 1, character: 12 });
    assert.equal(hit?.Symbol, "person");
});

test("an object declared inside a model is a definition target", () =>
{
    const defs = IndexFixture.DefsOf([
        "namespace app {",
        "  concept component { }",
        "  model prod : app {",
        "    component checkout { }",
        "  }",
        "}",
    ].join("\n"));
    assert.equal(defs.Get("checkout")?.Kind, SymbolKind.Instance);
    assert.equal(defs.Get("prod")?.Kind, SymbolKind.Instance);
});

test("a nested object inside a model object is a definition target", () =>
{
    const defs = IndexFixture.DefsOf([
        "namespace app {",
        "  concept component { }",
        "  model prod : app {",
        "    component outer { component inner { } }",
        "  }",
        "}",
    ].join("\n"));
    assert.ok(defs.Get("inner"));
});
