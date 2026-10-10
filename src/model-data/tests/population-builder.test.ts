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
