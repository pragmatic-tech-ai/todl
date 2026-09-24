import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../compiler-services/model/model.js";
import { toJSON, type TodlDocument } from "../../compiler-services/emit/json.js";
import type { ReflectedEntity } from "../../reflection-client/reflected-entity.js";
import { ModelDataSource } from "../model-data-source.js";
import type { IModelDataConnector } from "../model-data-connector.js";

// Two concepts (no namespace ⇒ fullName === name), each with one instance.
function twoConceptDoc(): TodlDocument
{
    const r = new Repository();
    const b = r.builder();
    b.definePrimitive("string");
    b.defineConcept("widget");
    b.addField("widget", "label", "string");
    b.defineConcept("gadget");
    b.addField("gadget", "label", "string");
    b.assertInstance("widget", "w1");
    b.setField("w1", "label", "W1");
    b.assertInstance("gadget", "g1");
    b.setField("g1", "label", "G1");
    b.commit();
    return toJSON(r);
}

class Probe extends ModelDataSource
{
    constructor(connector?: IModelDataConnector) { super(connector); this.modelName = "probe"; this.modelVersion = "0.0.0"; }
    static viaDocument(doc: TodlDocument): Probe { const p = new Probe(); p.loadDocument(doc); return p; }
}

test("ConceptNames lists domain concepts (excludes the prelude root)", () =>
{
    const src = Probe.viaDocument(twoConceptDoc());
    assert.deepEqual([...src.ConceptNames()].sort(), ["gadget", "widget"]);
});

test("Instances(concept) returns that concept's instances, and every ConceptName round-trips", () =>
{
    const src = Probe.viaDocument(twoConceptDoc());
    assert.deepEqual(src.Instances("widget").map((e: ReflectedEntity) => e.id), ["w1"]);
    assert.deepEqual(src.Instances("gadget").map((e: ReflectedEntity) => e.id), ["g1"]);
    // round-trip: each ConceptNames() entry resolves to instances via Instances()
    for (const c of src.ConceptNames())
    {
        assert.ok(src.Instances(c).length > 0, `no instances resolved for concept "${c}"`);
    }
});
