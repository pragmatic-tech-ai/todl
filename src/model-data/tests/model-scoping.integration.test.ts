import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { Repository } from "../../compiler-services/model/model.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import type { ReflectedEntity } from "../../reflection-client/reflected-entity.js";
import type { IModelDataConnector } from "../model-data-connector.js";
import { ModelDataSource } from "../model-data-source.js";
import { ModelShardExtractor } from "../model-shard-extractor.js";
import { BundledModelDataConnector } from "../bundled-model-data-connector.js";
import { ModelRegistry } from "../model-registry.js";

// Two models over one shared concept, each with distinct instances.
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
    b.assertModel("m2");
    b.assertInstance("technology", "cursor");
    b.setField("cursor", "label", "Cursor");
    b.addContains("m2", "cursor");
    b.commit();
    return r;
}

class TechModel extends ModelDataSource
{
    constructor(name: string, connector: IModelDataConnector)
    {
        super(connector);
        this.modelName = name;
        this.modelVersion = "0.0.0";
    }

    public technologies(): readonly ReflectedEntity[]
    {
        return this.instancesOf("technology");
    }
}

test("each model's source returns only its own instances (cross-model isolation)", async () =>
{
    const doc = toJSON(twoModelRepo());
    const registry = new ModelRegistry();
    for (const modelId of ModelShardExtractor.ModelsOf(doc))
    {
        const shard = ModelShardExtractor.Extract(doc, modelId);
        registry.Register(modelId, new TechModel(modelId, new BundledModelDataConnector(shard)));
    }

    await registry.PrepareAll(new ServiceProvider());

    const m1 = registry.GetRequired("m1") as TechModel;
    const m2 = registry.GetRequired("m2") as TechModel;
    assert.deepEqual(m1.technologies().map((e) => e.id), ["copilot"]);
    assert.deepEqual(m2.technologies().map((e) => e.id), ["cursor"]);
    // isolation: m1 does not see m2's instance and vice versa
    assert.equal(m1.technologies().find((e) => e.id === "cursor"), undefined);
    assert.equal(m2.technologies().find((e) => e.id === "copilot"), undefined);
});
