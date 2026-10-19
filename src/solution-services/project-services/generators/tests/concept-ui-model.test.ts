import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../../../compiler-services/api.js";
import { fromJSON, toJSON } from "../../../../compiler-services/emit/json.js";
import { ConceptUiModel, UiFieldType } from "../concept-ui-model.js";

const MODEL = "namespace acme { concept Order { total : number?; } concept Customer { name : string; age : integer?; active : boolean?; tags : string*; orders : Order*; class : string?; } }";

test("ConceptUiModel keeps single-valued scalars, drops references and many-valued, sanitizes identifiers", () =>
{
    const repo = fromJSON(toJSON(check([{ uri: "m.todl", text: MODEL }]).model));
    const ui = ConceptUiModel.For(repo, "acme.Customer");
    const names = ui.Fields.map(f => f.Name);
    assert.deepEqual(names, ["active", "age", "class", "name"]);
    assert.equal(ui.ClassName, "Customer");
    assert.equal(ui.Fields.find(f => f.Name === "age")!.Type, UiFieldType.Number);
    assert.equal(ui.Fields.find(f => f.Name === "active")!.Type, UiFieldType.Boolean);
    assert.equal(ui.Fields.find(f => f.Name === "name")!.Required, true);
    assert.equal(ui.Fields.find(f => f.Name === "age")!.Required, false);
    assert.notEqual(ui.Fields.find(f => f.Name === "class")!.BindingName, "class");
    assert.equal(ConceptUiModel.SafeIdentifier("a-b c"), "abc");
});

test("ConceptUiModel gives colliding sanitized names distinct BindingNames", () =>
{
    assert.equal(ConceptUiModel.SafeIdentifier("a-b"), ConceptUiModel.SafeIdentifier("ab"));
    // "class" sanitizes to "classField", colliding with the real field of that name.
    const repo = fromJSON(toJSON(check([{ uri: "m.todl", text: "namespace acme { concept Odd { class : string?; classField : string?; } }" }]).model));
    const ui = ConceptUiModel.For(repo, "acme.Odd");
    assert.deepEqual(ui.Fields.map(f => f.Name), ["class", "classField"]);
    assert.equal(new Set(ui.Fields.map(f => f.BindingName)).size, 2);
});
