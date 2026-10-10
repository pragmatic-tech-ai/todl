import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceKind, ConnectorPlanProjection, type ModelConnectorPlan } from "../connector-plan.js";

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
