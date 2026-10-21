import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { Repository } from "../../compiler-services/model/model.js";
import { Cardinality } from "../../compiler-services/model/graph.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import type { TodlDocument } from "../../compiler-services/emit/json.js";
import type { ReflectedEntity } from "../../reflection-client/reflected-entity.js";
import { ReflectedRepository } from "../../reflection-client/reflected-repository.js";
import { ModelDataSource } from "../model-data-source.js";
import { DocumentModelDataConnector } from "../document-model-data-connector.js";
import type { IModelDataConnector } from "../model-data-connector.js";

// billing + technology concepts with a reference field, and instances.
function miniRepo(): Repository
{
    const r = new Repository();
    const b = r.builder();
    b.definePrimitive("string");
    b.defineConcept("billing");
    b.addField("billing", "label", "string");
    b.defineConcept("technology");
    b.addField("technology", "label", "string");
    b.addField("technology", "billing", "billing", Cardinality.Optional);
    b.assertInstance("billing", "subscription");
    b.setField("subscription", "label", "Subscription");
    b.assertInstance("technology", "copilot");
    b.setField("copilot", "label", "Copilot");
    b.addRelationship("copilot", "billing", "subscription");
    b.commit();
    return r;
}

// A minimal concrete source over ModelDataSource, exposing two collections.
class MiniSource extends ModelDataSource
{
    constructor(connector?: IModelDataConnector)
    {
        super(connector);
        this.modelName = "mini";
        this.modelVersion = "0.0.0";
    }

    static viaDocument(doc: TodlDocument): MiniSource
    {
        const s = new MiniSource();
        s.loadDocument(doc);
        return s;
    }

    public billings(): readonly ReflectedEntity[]
    {
        return this.instancesOf("billing");
    }

    public technologies(): readonly ReflectedEntity[]
    {
        return this.instancesOf("technology");
    }
}

test("materializes from a document in hand and exposes typed instances", () =>
{
    const src = MiniSource.viaDocument(toJSON(miniRepo()));
    assert.deepEqual(src.billings().map((e) => e.id), ["subscription"]);
    assert.deepEqual(src.technologies().map((e) => e.id), ["copilot"]);
});

test("Prepare materializes through a connector and preserves reference identity", async () =>
{
    const src = new MiniSource(new DocumentModelDataConnector(toJSON(miniRepo())));
    await src.Prepare(new ServiceProvider());
    assert.deepEqual(src.technologies().map((e) => e.id), ["copilot"]);
    // the billing reached via entity() is the same object as the collection member
    assert.equal(src.entity("subscription"), src.billings()[0]);
});

test("Type returns the reflected concept type, undefined for a missing concept", () =>
{
    const src = MiniSource.viaDocument(toJSON(miniRepo()));
    const type = src.Type("billing");
    assert.ok(type !== undefined);
    assert.equal(type.fullName, "billing");
    assert.equal(src.Type("Missing"), undefined);
});

test("Prepare without a connector throws a clear error", async () =>
{
    const src = new MiniSource();
    await assert.rejects(() => src.Prepare(new ServiceProvider()), /requires a connector/);
});

test("ReflectedRepository back-compat load(doc, model, version) still works", () =>
{
    class LegacySource extends ReflectedRepository
    {
        static fromJSON(doc: TodlDocument): LegacySource
        {
            const s = new LegacySource();
            s.load(doc, "mini", "0.0.0");
            return s;
        }

        public billings(): readonly ReflectedEntity[]
        {
            return this.instancesOf("billing");
        }
    }

    const src = LegacySource.fromJSON(toJSON(miniRepo()));
    assert.deepEqual(src.billings().map((e) => e.id), ["subscription"]);
});

class RefreshableConnector implements IModelDataConnector
{
    public constructor(private readonly first: TodlDocument, private readonly second: TodlDocument)
    {
    }

    public async Prepare(): Promise<TodlDocument>
    {
        return this.first;
    }

    public async Refresh(): Promise<TodlDocument>
    {
        return this.second;
    }
}

class PrepareOnlyConnector implements IModelDataConnector
{
    public constructor(private readonly doc: TodlDocument)
    {
    }

    public async Prepare(): Promise<TodlDocument>
    {
        return this.doc;
    }
}

class LabelRepo
{
    public static With(label: string): Repository
    {
        const r = miniRepo();
        const b = r.builder();
        b.setField("subscription", "label", label);
        b.commit();
        return r;
    }
}

test("Refresh rebuilds the graph and a previously-fetched entity reflects new values", async () =>
{
    const connector = new RefreshableConnector(toJSON(LabelRepo.With("v1")), toJSON(LabelRepo.With("v2")));
    const src = new MiniSource(connector);
    await src.Prepare(new ServiceProvider());
    assert.equal(src.entity("subscription")?.Snapshot()["label"], "v1");
    await src.Refresh(new ServiceProvider());
    assert.equal(src.entity("subscription")?.Snapshot()["label"], "v2");
});

test("Refresh on a source whose connector cannot refresh throws a clear not-refreshable error", async () =>
{
    const src = new MiniSource(new PrepareOnlyConnector(toJSON(miniRepo())));
    await src.Prepare(new ServiceProvider());
    await assert.rejects(() => src.Refresh(new ServiceProvider()), /supports Refresh/);
});

test("Refresh before Prepare performs the initial pull", async () =>
{
    const connector = new RefreshableConnector(toJSON(LabelRepo.With("v1")), toJSON(LabelRepo.With("v2")));
    const src = new MiniSource(connector);
    await src.Refresh(new ServiceProvider());
    assert.equal(src.entity("subscription")?.Snapshot()["label"], "v1");
});
