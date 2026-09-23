import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { Repository } from "../../compiler-services/model/model.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import type { TodlDocument } from "../../compiler-services/emit/json.js";
import type { ReflectedEntity } from "../../reflection-client/reflected-entity.js";
import { ModelDataSource } from "../model-data-source.js";
import type { IModelDataConnector } from "../model-data-connector.js";
import { BundledModelDataConnector } from "../bundled-model-data-connector.js";
import { ModelRegistry } from "../model-registry.js";

function billingRepo(): Repository
{
    const r = new Repository();
    const b = r.builder();
    b.definePrimitive("string");
    b.defineConcept("billing");
    b.addField("billing", "label", "string");
    b.assertInstance("billing", "subscription");
    b.setField("subscription", "label", "Subscription");
    b.commit();
    return r;
}

// A concrete source exposing one collection, for exercising the base.
class MiniSource extends ModelDataSource
{
    constructor(connector?: IModelDataConnector)
    {
        super(connector);
        this.modelName = "mini";
        this.modelVersion = "0.0.0";
    }

    public billings(): readonly ReflectedEntity[]
    {
        return this.instancesOf("billing");
    }
}

// A connector that counts how many times Prepare was called.
class CountingConnector implements IModelDataConnector
{
    public calls = 0;
    constructor(private readonly doc: TodlDocument) {}
    public Prepare(_services: IServiceProvider): Promise<TodlDocument>
    {
        this.calls += 1;
        return Promise.resolve(this.doc);
    }
}

test("BundledModelDataConnector.Prepare resolves to the embedded shard", async () =>
{
    const shard = toJSON(billingRepo());
    const connector = new BundledModelDataConnector(shard);
    assert.equal(await connector.Prepare(new ServiceProvider()), shard);
});

test("Prepare is idempotent: a second call is a no-op and the connector is called once", async () =>
{
    const connector = new CountingConnector(toJSON(billingRepo()));
    const src = new MiniSource(connector);
    await src.Prepare(new ServiceProvider());
    const first = src.billings()[0];
    await src.Prepare(new ServiceProvider());
    assert.equal(connector.calls, 1, "connector Prepare called exactly once");
    assert.equal(src.billings()[0], first, "entity identity stable across the second Prepare");
});

test("ModelRegistry Register/Get/Models and GetRequired throws on unknown", () =>
{
    const registry = new ModelRegistry();
    const src = new MiniSource();
    registry.Register("mini", src);
    assert.equal(registry.Get("mini"), src);
    assert.equal(registry.Get("nope"), undefined);
    assert.deepEqual(registry.Models(), ["mini"]);
    assert.throws(() => registry.GetRequired("nope"), /no data source registered for model nope/);
});

test("ModelRegistry.PrepareAll prepares every registered source", async () =>
{
    const registry = new ModelRegistry();
    registry.Register("mini", new MiniSource(new BundledModelDataConnector(toJSON(billingRepo()))));
    await registry.PrepareAll(new ServiceProvider());
    const src = registry.GetRequired("mini") as MiniSource;
    assert.deepEqual(src.billings().map((e) => e.id), ["subscription"]);
});
