import { test } from "node:test";
import assert from "node:assert/strict";
import { SymbolKind } from "vscode-languageserver-types";
import { MarkedSource } from "./marked-fixture.js";
import { DocumentSymbolProvider } from "../document-symbol-provider.js";

test("outlines concepts with their fields and relationships as children", () =>
{
    const { analysis, uri } = MarkedSource.Fixture("d.todl", [
        "namespace demo {",
        "  concept dog { name : string; relationship owner -> person []; }",
        "  dog rex { }",
        "}",
    ].join("\n"));
    const syms = new DocumentSymbolProvider().Of(analysis, uri);
    const names = syms.map((s) => s.name).sort();
    assert.deepEqual(names, ["dog", "rex"]);
    const dog = syms.find((s) => s.name === "dog")!;
    assert.equal(dog.kind, SymbolKind.Class);
    assert.deepEqual(dog.children?.map((c) => c.name).sort(), ["name", "owner"]);
});
