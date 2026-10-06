import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../../../compiler-services/api.js";
import { SymbolKind, SymbolKinds } from "../symbol-kinds.js";

test("SymbolKinds.Of distinguishes concepts, primitives, and instances", () =>
{
    const { model } = check([{ uri: "d.todl", text: [
        "namespace demo {",
        "  primitive string { }",
        "  concept person { name : string; }",
        "  person alice { }",
        "}",
    ].join("\n") }]);
    assert.equal(SymbolKinds.Of(model, "demo.person"), SymbolKind.Concept);
    assert.equal(SymbolKinds.Of(model, "string"), SymbolKind.Primitive);
    assert.equal(SymbolKinds.Of(model, "demo.alice"), SymbolKind.Instance);
    assert.equal(SymbolKinds.Of(model, "no-such-id"), SymbolKind.Unknown);
});
