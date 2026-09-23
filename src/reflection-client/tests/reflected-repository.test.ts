import { test } from "node:test";
import assert from "node:assert/strict";
import { Repository } from "../../compiler-services/model/model.js";
import { Cardinality } from "../../compiler-services/model/graph.js";
import { toJSON } from "../../compiler-services/emit/json.js";
import { ReflectedRepository } from "../reflected-repository.js";
import type { ReflectedEntity } from "../reflected-entity.js";

function catalogDoc()
{
    const r = new Repository();
    const b = r.builder();
    b.definePrimitive("string");
    b.defineConcept("billing");
    b.addField("billing", "label", "string");
    b.defineConcept("location");
    b.addField("location", "label", "string");
    b.defineConcept("technology");
    b.addField("technology", "label", "string");
    b.addField("technology", "billing", "billing", Cardinality.Optional);
    b.addField("technology", "availableIn", "location", Cardinality.Many);
    b.defineTaxonomy("stack", ["technology"], [{ id: "m365", attrs: new Map([["label", "M365"]]) }]);
    b.assertInstance("billing", "subscription");
    b.setField("subscription", "label", "Subscription");
    b.assertInstance("location", "westeurope");
    b.setField("westeurope", "label", "West Europe");
    b.assertInstance("technology", "copilot");
    b.setField("copilot", "label", "Copilot");
    b.addRelationship("copilot", "billing", "subscription");
    b.addRelationship("copilot", "availableIn", "westeurope");
    b.commit();
    return toJSON(r);
}

class Cat extends ReflectedRepository
{
    static open(): Cat
    {
        const c = new Cat();
        c.load(catalogDoc(), "tech-catalog", "0.0.0");
        return c;
    }

    technologies(): readonly ReflectedEntity[]
    {
        return this.instancesOf("technology");
    }

    locations(): readonly ReflectedEntity[]
    {
        return this.instancesOf("location");
    }

    stack(): readonly ReflectedEntity[]
    {
        return this.termsOf("stack");
    }
}

test("instancesOf reflects heap instances", () =>
{
    const c = Cat.open();
    assert.deepEqual(c.technologies().map((e) => e.id).sort(), ["copilot"]);
});

test("entity() is identity-mapped (same handle for same id)", () =>
{
    const c = Cat.open();
    assert.equal(c.entity("westeurope"), c.entity("westeurope"));
    assert.equal(c.entity("westeurope"), c.locations()[0]);
});

test("termsOf returns term entities reading fixed values", () =>
{
    const c = Cat.open();
    const stack = c.stack();
    assert.deepEqual(stack.map((e) => e.id), ["stack.m365"]);
});
