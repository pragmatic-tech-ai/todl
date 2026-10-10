import { test } from "node:test";
import assert from "node:assert/strict";
import { PopulationBuilder } from "../population-builder.js";
import type { ConnectorBinding } from "../connector-plan.js";
import type { TodlDocument } from "../../compiler-services/emit/json.js";

const EMPTY: TodlDocument = { nodes: [], edges: [] };

test("maps external fields to members via inverse map and stamps storageId", () =>
{
    const binding: ConnectorBinding =
    {
        Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "order_id",
        FieldMap: { id: "order_id", label: "display_name" }, Writable: true,
    };
    const doc = new PopulationBuilder(EMPTY)
        .Add(binding, [{ order_id: "O-1007", display_name: "Acme reorder" }])
        .Build();
    const order = doc.nodes.find((n) => n.storageId === "O-1007");
    assert.ok(order, "instance was created and keyed by storageId");
    assert.equal(order!.type, "a.Order");
    assert.equal(order!.attrs["label"], "Acme reorder");
});

test("preserves the hand-authored base shard alongside pulled instances", () =>
{
    const base: TodlDocument = { nodes: [{ id: "a.Customer#c1", tier: "Instance", type: "a.Customer", metaKind: null, namespace: "a", localId: "Customer#c1", isClass: false, class: null, storageId: null, canonicalId: null, fields: [], attrs: { label: "Hand" } }], edges: [] };
    const binding: ConnectorBinding = { Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "id", FieldMap: { id: "id" }, Writable: true };
    const doc = new PopulationBuilder(base).Add(binding, [{ id: "O-1" }]).Build();
    assert.ok(doc.nodes.some((n) => n.id === "a.Customer#c1"), "base instance retained");
    assert.ok(doc.nodes.some((n) => n.storageId === "O-1"), "pulled instance added");
});

test("skips records missing the id key but keeps siblings", () =>
{
    const binding: ConnectorBinding = { Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "id", FieldMap: { id: "id", label: "name" }, Writable: true };
    const doc = new PopulationBuilder(EMPTY).Add(binding, [{ name: "no id" }, { id: "O-2", name: "ok" }]).Build();
    assert.equal(doc.nodes.length, 1);
    assert.equal(doc.nodes[0]!.storageId, "O-2");
});

test("dotless concept id yields null namespace", () =>
{
    const binding: ConnectorBinding = { Concept: "Order", Connector: "pg", Source: "order", IdKey: "id", FieldMap: { id: "id" }, Writable: true };
    const node = new PopulationBuilder(EMPTY).Add(binding, [{ id: 7 }]).Build().nodes[0]!;
    assert.equal(node.namespace, null);
    assert.equal(node.localId, "Order#pg.order#7");
    assert.equal(node.storageId, "7");
    assert.equal(node.tier, "Instance");
});

test("does not stamp the id member as an attr; storageId carries it", () =>
{
    const binding: ConnectorBinding = { Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "order_id", FieldMap: { id: "order_id", label: "display_name" }, Writable: true };
    const node = new PopulationBuilder(EMPTY).Add(binding, [{ order_id: "O-9", display_name: "Nine" }]).Build().nodes[0]!;
    assert.equal(node.storageId, "O-9");
    assert.equal(node.attrs["label"], "Nine");
    assert.ok(!("id" in node.attrs), "no spurious id attr");
});

test("Sources maps each minted node id to its binding connector and source", () =>
{
    const base = { nodes: [], edges: [] };
    const builder = new PopulationBuilder(base);
    const contacts = { Concept: "shop.Customer", Connector: "opsdb", Source: "contacts", IdKey: "customer_id", FieldMap: { customer_id: "customer_id", email: "email" }, Writable: true };
    const crm = { Concept: "shop.Customer", Connector: "opsdb", Source: "crm_accounts", IdKey: "customer_id", FieldMap: { customer_id: "customer_id", email: "email" }, Writable: true };
    builder.Add(contacts, [{ customer_id: "C1", email: "new@acme.com" }]);
    builder.Add(crm, [{ customer_id: "C1", email: "old@acme.com" }]);
    const sources = builder.Sources();
    assert.deepEqual(sources.get("shop.Customer#opsdb.contacts#C1"), { Connector: "opsdb", Source: "contacts" });
    assert.deepEqual(sources.get("shop.Customer#opsdb.crm_accounts#C1"), { Connector: "opsdb", Source: "crm_accounts" });
    assert.equal(sources.size, 2);
});
