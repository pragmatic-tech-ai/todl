import { test } from "node:test";
import assert from "node:assert/strict";
import { TextBlock } from "@pragmatic-tech-ai/mural/basic";
import type { Visual } from "@pragmatic-tech-ai/mural";
import { Repository } from "../../compiler-services/model/model.js";
import { toJSON, type TodlDocument } from "../../compiler-services/emit/json.js";
import { ModelDataSource } from "../../model-data/model-data-source.js";
import type { IModelDataConnector } from "../../model-data/model-data-connector.js";
import { ModelBrowserView } from "../model-browser-view.js";

function twoConceptDoc(): TodlDocument
{
    const r = new Repository();
    const b = r.builder();
    b.definePrimitive("string");
    b.defineConcept("widget");
    b.addField("widget", "label", "string");
    b.assertInstance("widget", "w1");
    b.setField("w1", "label", "W1");
    b.assertInstance("widget", "w2");
    b.setField("w2", "label", "W2");
    b.commit();
    return toJSON(r);
}

class Probe extends ModelDataSource
{
    constructor(connector?: IModelDataConnector) { super(connector); this.modelName = "probe"; this.modelVersion = "0.0.0"; }
    static viaDocument(doc: TodlDocument): Probe { const p = new Probe(); p.loadDocument(doc); return p; }
}

// Collect the Text of every TextBlock directly under the panel (one level).
function textsOf(root: Visual): string[]
{
    return root.visualChildren
        .filter((c): c is TextBlock => c instanceof TextBlock)
        .map((t) => t.Text ?? "");
}

test("Build renders a concept header and one TextBlock per instance", () =>
{
    const view = ModelBrowserView.Build(Probe.viaDocument(twoConceptDoc()));
    const texts = textsOf(view);
    assert.ok(texts.includes("widget"), `expected concept header "widget" in ${JSON.stringify(texts)}`);
    assert.ok(texts.includes("w1"), "expected instance w1");
    assert.ok(texts.includes("w2"), "expected instance w2");
});

test("Build on an undefined root renders the empty state (no throw)", () =>
{
    const view = ModelBrowserView.Build(undefined);
    const texts = textsOf(view);
    assert.equal(texts.length, 1);
    assert.match(texts[0]!, /no|empty/i);
});
