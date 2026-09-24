import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../compiler-services/model/model.js";
import { MetaKind } from "../../compiler-services/model/kinds.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import type { TodlDocument } from "../../compiler-services/emit/json.js";
import { ApplicationRootResolver } from "../application-root-resolver.js";
import { ModelRegistry } from "../model-registry.js";
import { ModelDataSource } from "../model-data-source.js";
import type { IModelDataConnector } from "../model-data-connector.js";

// A repo with one model marked `application` (via builder.annotate on the model node).
function appDoc(): TodlDocument
{
    const r = new Repository();
    const b = r.builder();
    b.definePrimitive("string");
    b.defineConcept("technology");
    b.addField("technology", "label", "string");
    b.defineAnnotation("application");
    b.assertModel("app");
    b.assertInstance("technology", "x");
    b.setField("x", "label", "X");
    b.addContains("app", "x");
    b.annotate("app", "application");
    b.commit();
    return toJSON(r);
}

function libDoc(): TodlDocument
{
    const r = new Repository();
    const b = r.builder();
    b.definePrimitive("string");
    b.defineConcept("technology");
    b.addField("technology", "label", "string");
    b.assertModel("m");
    b.assertInstance("technology", "x");
    b.setField("x", "label", "X");
    b.addContains("m", "x");
    b.commit();
    return toJSON(r);
}

class MiniSource extends ModelDataSource
{
    constructor(connector?: IModelDataConnector)
    {
        super(connector);
        this.modelName = "app";
        this.modelVersion = "0.0.0";
    }
}

test("Resolve returns the application-marked model id", () =>
{
    assert.equal(ApplicationRootResolver.Resolve(appDoc()), "app");
});

test("Resolve returns undefined for a library document", () =>
{
    assert.equal(ApplicationRootResolver.Resolve(libDoc()), undefined);
});

test("Resolve throws on a malformed document with more than one marked model", () =>
{
    const doc = appDoc();
    // Fabricate a second marked model: a model node + an application app node + Annotated edge.
    doc.nodes.push({ id: "app2", tier: "Instance", type: null, metaKind: MetaKind.Model, namespace: null, localId: "app2", isClass: false, class: null, storageId: null, fields: [], attrs: {} });
    doc.nodes.push({ id: "app2@application", tier: "Ontology", type: "application", metaKind: null, namespace: null, localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: {} });
    doc.edges.push({ kind: "Annotated", via: null, from: "app2", to: "app2@application" });
    assert.throws(() => ApplicationRootResolver.Resolve(doc), /more than one application-marked model/);
});

test("ModelRegistry Root/RootModel reflect the set root", () =>
{
    const registry = new ModelRegistry();
    const src = new MiniSource();
    registry.Register("app", src).SetRoot("app");
    assert.equal(registry.RootModel(), "app");
    assert.equal(registry.Root(), src);
});

test("ModelRegistry Root is undefined when no root is set", () =>
{
    assert.equal(new ModelRegistry().Root(), undefined);
});
