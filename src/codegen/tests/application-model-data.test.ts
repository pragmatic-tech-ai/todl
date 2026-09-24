import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAgainst } from "../../compiler-services/api.js";
import { Repository } from "../../compiler-services/model/model.js";
import { ApplicationModelData } from "../application-model-data.js";

// One model, no entrypoint (base binding `: acme` = the namespace, as in html-bundle.test).
function soleModel(): Repository
{
    return checkAgainst([], [{ uri: "m.todl", text:
        `namespace acme { concept App { label : string?; } model M : acme { App a1 { label = "A1"; } } }` }]).model;
}

// Two models, no entrypoint.
function twoModels(): Repository
{
    return checkAgainst([], [{ uri: "m.todl", text:
        `namespace acme { concept App { label : string?; } model M1 : acme { App a1 { label = "A1"; } } model M2 : acme { App a2 { label = "A2"; } } }` }]).model;
}

test("WithSoleModelFallback picks the sole model when there is no entrypoint", () =>
{
    const { root, shards } = ApplicationModelData.WithSoleModelFallback(soleModel());
    assert.equal(shards.size, 1);
    assert.ok(shards.has(root), "root id is one of the extracted shard ids");
});

test("WithSoleModelFallback throws on multiple models with no entrypoint", () =>
{
    assert.throws(() => ApplicationModelData.WithSoleModelFallback(twoModels()), /application root/);
});

test("Strict throws when there is no entrypoint even for a sole model", () =>
{
    assert.throws(() => ApplicationModelData.Strict(soleModel()), /entrypoint/);
});
