import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../api.js";

test("a model block can carry an annotate application marker, applied to the model node", () =>
{
    const { model, diagnostics } = check([{
        uri: "app.todl",
        text: `namespace a { concept C { name : string; } model M : a { annotate application { } C x { name = "X"; } } }`,
    }]);
    assert.deepEqual(diagnostics, []);
    assert.notEqual(model.resolve("M@application"), undefined, "model node M carries the application annotation app node");
});

test("a model with no annotation has no application app node", () =>
{
    const { model, diagnostics } = check([{
        uri: "lib.todl",
        text: `namespace a { concept C { name : string; } model M : a { C x { name = "X"; } } }`,
    }]);
    assert.deepEqual(diagnostics, []);
    assert.equal(model.resolve("M@application"), undefined);
});
