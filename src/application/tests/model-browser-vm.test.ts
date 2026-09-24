import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../compiler-services/model/model.js";
import { toJSON, type TodlDocument } from "../../compiler-services/emit/json.js";
import { ModelDataSource } from "../../model-data/model-data-source.js";
import type { IModelDataConnector } from "../../model-data/model-data-connector.js";
import { ConceptHeaderVM, InstanceRowVM, ModelBrowserVM } from "../model-browser-vm.js";

class Probe extends ModelDataSource
{
    constructor(connector?: IModelDataConnector) { super(connector); this.modelName = "probe"; this.modelVersion = "0.0.0"; }
    static viaDocument(doc: TodlDocument): Probe { const p = new Probe(); p.loadDocument(doc); return p; }
}

class Fixtures
{
    public static TwoInstanceDoc(): TodlDocument
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

    public static NoInstanceDoc(): TodlDocument
    {
        const r = new Repository();
        const b = r.builder();
        b.definePrimitive("string");
        b.defineConcept("widget");
        b.addField("widget", "label", "string");
        b.commit();
        return toJSON(r);
    }

    public static Labels(vm: ModelBrowserVM): string[]
    {
        return vm.Rows.ToArray().map((row) =>
        {
            if (row instanceof ConceptHeaderVM) return `H:${row.Concept}`;
            if (row instanceof InstanceRowVM) return `R:${row.Text}`;
            return "?";
        });
    }
}

test("For yields a concept header followed by one row per instance", () =>
{
    const vm = ModelBrowserVM.For(Probe.viaDocument(Fixtures.TwoInstanceDoc()));
    assert.deepEqual(Fixtures.Labels(vm), ["H:widget", "R:w1", "R:w2"]);
});

test("For skips concepts with no instances and shows the empty state", () =>
{
    const vm = ModelBrowserVM.For(Probe.viaDocument(Fixtures.NoInstanceDoc()));
    const labels = Fixtures.Labels(vm);
    assert.equal(labels.length, 1);
    assert.match(labels[0]!, /^R:.*no instances/i);
});

test("For on an undefined root shows a single empty-state row", () =>
{
    const vm = ModelBrowserVM.For(undefined);
    const labels = Fixtures.Labels(vm);
    assert.equal(labels.length, 1);
    assert.match(labels[0]!, /^R:.*no instances/i);
});
