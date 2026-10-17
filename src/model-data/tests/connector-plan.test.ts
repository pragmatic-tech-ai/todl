import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceKind, ConnectorPlanProjection, ConnectorLookup, type ConnectorBinding, type ConnectorSpec, type ModelConnectorPlan } from "../connector-plan.js";

test("Normalize sorts connectors, bindings, and field-map keys deterministically", () =>
{
    const plan: ModelConnectorPlan =
    {
        Model: "Sales",
        Version: "0.0.0",
        Connectors:
        [
            { Name: "warehouse", Kind: DataSourceKind.Sql, Config: { host: "h" }, Secret: "warehouse-ro" },
            { Name: "pg", Kind: DataSourceKind.Sql, Connection: "crm-postgres", Config: {} },
        ],
        Bindings:
        [
            { Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "order_id", FieldMap: { label: "display_name", id: "order_id" }, Writable: true },
            { Concept: "a.Customer", Connector: "pg", Source: "Customer", IdKey: "id", FieldMap: { id: "id" }, Writable: true },
        ],
    };
    const normalized = ConnectorPlanProjection.Normalize(plan);
    assert.deepEqual(normalized.Connectors.map((c) => c.Name), ["pg", "warehouse"]);
    assert.deepEqual(normalized.Bindings.map((b) => b.Concept), ["a.Customer", "a.Order"]);
    assert.deepEqual(Object.keys(normalized.Bindings[1]!.FieldMap), ["id", "label"]);
});

test("Normalize does not mutate its input", () =>
{
    const plan: ModelConnectorPlan =
    {
        Model: "Sales",
        Version: "0.0.0",
        Connectors:
        [
            { Name: "warehouse", Kind: DataSourceKind.Sql, Config: {} },
            { Name: "pg", Kind: DataSourceKind.Sql, Config: {} },
        ],
        Bindings:
        [
            { Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "id", FieldMap: { label: "l", id: "i" }, Writable: true },
            { Concept: "a.Customer", Connector: "pg", Source: "Customer", IdKey: "id", FieldMap: {}, Writable: true },
        ],
    };
    ConnectorPlanProjection.Normalize(plan);
    assert.equal(plan.Connectors[0]!.Name, "warehouse");
    assert.equal(plan.Bindings[0]!.Concept, "a.Order");
    assert.deepEqual(Object.keys(plan.Bindings[0]!.FieldMap), ["label", "id"]);
});

test("ConnectorLookup.Find links by qualified ConnectorId when bare names collide across namespaces", () =>
{
    const shopPg: ConnectorSpec = { Id: "shop@connector:pg", Name: "pg", Kind: DataSourceKind.Sql, Config: { db: "shop" } };
    const invPg: ConnectorSpec = { Id: "inventory@connector:pg", Name: "pg", Kind: DataSourceKind.Sql, Config: { db: "inventory" } };
    const binding: ConnectorBinding =
    {
        Concept: "inventory.Item", Connector: "pg", ConnectorId: "inventory@connector:pg",
        Source: "items", IdKey: "id", FieldMap: {}, Writable: false,
    };
    // Bare Name "pg" matches both specs; the qualified ConnectorId disambiguates to the inventory one.
    assert.equal(ConnectorLookup.Find([shopPg, invPg], binding), invPg);
});

test("ConnectorLookup.TryFind falls back to bare Connector name for legacy plans (no ConnectorId)", () =>
{
    const pg: ConnectorSpec = { Name: "pg", Kind: DataSourceKind.Sql, Config: {} };
    const legacy: ConnectorBinding = { Concept: "a.X", Connector: "pg", Source: "s", IdKey: "id", FieldMap: {}, Writable: false };
    assert.equal(ConnectorLookup.TryFind([pg], legacy), pg);
});

test("ConnectorLookup.TryFind returns undefined when nothing matches", () =>
{
    const shopPg: ConnectorSpec = { Id: "shop@connector:pg", Name: "pg", Kind: DataSourceKind.Sql, Config: {} };
    const miss: ConnectorBinding = { Concept: "a.X", Connector: "x", ConnectorId: "nope@connector:x", Source: "s", IdKey: "id", FieldMap: {}, Writable: false };
    assert.equal(ConnectorLookup.TryFind([shopPg], miss), undefined);
});

test("Normalize sorts connector Config keys", () =>
{
    const plan: ModelConnectorPlan =
    {
        Model: "Sales",
        Version: "0.0.0",
        Connectors: [{ Name: "pg", Kind: DataSourceKind.Sql, Config: { b: "1", a: "2" } }],
        Bindings: [],
    };
    const normalized = ConnectorPlanProjection.Normalize(plan);
    assert.deepEqual(Object.keys(normalized.Connectors[0]!.Config), ["a", "b"]);
});
