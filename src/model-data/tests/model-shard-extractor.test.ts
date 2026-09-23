import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../compiler-services/model/model.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import { ModelShardExtractor } from "../model-shard-extractor.js";

// Two models over one shared ontology, plus a nested sub-model under m1.
function twoModelRepo(): Repository
{
    const r = new Repository();
    const b = r.builder();
    b.definePrimitive("string");
    b.defineConcept("technology");
    b.addField("technology", "label", "string");
    b.assertModel("m1");
    b.assertInstance("technology", "copilot");
    b.setField("copilot", "label", "Copilot");
    b.addContains("m1", "copilot");
    b.assertModel("sub");
    b.assertInstance("technology", "nested");
    b.setField("nested", "label", "Nested");
    b.addContains("sub", "nested");
    b.addContains("m1", "sub");
    b.assertModel("m2");
    b.assertInstance("technology", "cursor");
    b.setField("cursor", "label", "Cursor");
    b.addContains("m2", "cursor");
    b.commit();
    return r;
}

test("ModelsOf lists every model container id", () =>
{
    const doc = toJSON(twoModelRepo());
    assert.deepEqual([...ModelShardExtractor.ModelsOf(doc)].sort(), ["m1", "m2", "sub"]);
});

test("Extract keeps shared ontology + the model's Contains-closure instances (transitive), drops other models", () =>
{
    const doc = toJSON(twoModelRepo());
    const shard = ModelShardExtractor.Extract(doc, "m1");
    const ids = new Set(shard.nodes.map((n) => n.id));
    assert.ok(ids.has("technology"), "ontology concept retained");
    assert.ok(ids.has("copilot"), "own instance retained");
    assert.ok(ids.has("nested"), "nested sub-model instance retained (transitive)");
    assert.ok(!ids.has("cursor"), "other model instance dropped");
});

test("Extract strips model container nodes and Contains edges", () =>
{
    const doc = toJSON(twoModelRepo());
    const shard = ModelShardExtractor.Extract(doc, "m1");
    const ids = new Set(shard.nodes.map((n) => n.id));
    assert.ok(!ids.has("m1") && !ids.has("m2") && !ids.has("sub"), "no model containers");
    assert.ok(shard.edges.every((e) => e.kind !== "Contains"), "no Contains edges");
});

test("Extract drops edges whose endpoints are not both retained", () =>
{
    const doc = toJSON(twoModelRepo());
    const shard = ModelShardExtractor.Extract(doc, "m1");
    const ids = new Set(shard.nodes.map((n) => n.id));
    for (const e of shard.edges)
    {
        assert.ok(ids.has(e.from) && ids.has(e.to), `edge ${e.from}->${e.to} has both endpoints retained`);
    }
});
