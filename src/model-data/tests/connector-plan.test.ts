import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceKind, ConnectorPlanProjection, ConnectorLookup, ConnectorPlanValidator, WriteConcurrency, WriteAtomicity, type ConnectorBinding, type ConnectorSpec, type ModelConnectorPlan } from "../connector-plan.js";

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
            { Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "order_id", FieldMap: { label: "display_name", id: "order_id" }, Writable: true, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential },
            { Concept: "a.Customer", Connector: "pg", Source: "Customer", IdKey: "id", FieldMap: { id: "id" }, Writable: true, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential },
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
            { Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "id", FieldMap: { label: "l", id: "i" }, Writable: true, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential },
            { Concept: "a.Customer", Connector: "pg", Source: "Customer", IdKey: "id", FieldMap: {}, Writable: true, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential },
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
        Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential,
    };
    // Bare Name "pg" matches both specs; the qualified ConnectorId disambiguates to the inventory one.
    assert.equal(ConnectorLookup.Find([shopPg, invPg], binding), invPg);
});

test("ConnectorLookup.TryFind falls back to bare Connector name for legacy plans (no ConnectorId)", () =>
{
    const pg: ConnectorSpec = { Name: "pg", Kind: DataSourceKind.Sql, Config: {} };
    const legacy: ConnectorBinding = { Concept: "a.X", Connector: "pg", Source: "s", IdKey: "id", FieldMap: {}, Writable: false, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential };
    assert.equal(ConnectorLookup.TryFind([pg], legacy), pg);
});

test("ConnectorLookup.TryFind returns undefined when nothing matches", () =>
{
    const shopPg: ConnectorSpec = { Id: "shop@connector:pg", Name: "pg", Kind: DataSourceKind.Sql, Config: {} };
    const miss: ConnectorBinding = { Concept: "a.X", Connector: "x", ConnectorId: "nope@connector:x", Source: "s", IdKey: "id", FieldMap: {}, Writable: false, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential };
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

class ValidatorHarness
{
    public static Plan(binding: ConnectorBinding, connector: ConnectorSpec): ModelConnectorPlan
    {
        return { Model: "Sales", Version: "0.0.0", Connectors: [connector], Bindings: [binding] };
    }

    public static readonly Sql: ConnectorSpec = { Name: "pg", Kind: DataSourceKind.Sql, Config: {} };
    public static readonly GraphQl: ConnectorSpec = { Name: "api", Kind: DataSourceKind.Rest, Config: { style: "graphql" } };
}

test("Optimistic without a version field is a plan-build error", () =>
{
    const binding: ConnectorBinding =
    {
        Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "id",
        FieldMap: { id: "id", label: "name" }, Writable: true,
        Concurrency: WriteConcurrency.Optimistic, Atomicity: WriteAtomicity.Sequential,
    };
    assert.throws(() => ConnectorPlanValidator.Validate(ValidatorHarness.Plan(binding, ValidatorHarness.Sql)),
        /requires a version field/);
});

test("Optimistic whose version field is absent from the field map is a plan-build error", () =>
{
    const binding: ConnectorBinding =
    {
        Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "id",
        FieldMap: { id: "id", label: "name" }, Writable: true, VersionField: "ghost",
        Concurrency: WriteConcurrency.Optimistic, Atomicity: WriteAtomicity.Sequential,
    };
    assert.throws(() => ConnectorPlanValidator.Validate(ValidatorHarness.Plan(binding, ValidatorHarness.Sql)),
        /not in its field map/);
});

test("Optimistic on a GraphQL connector is a plan-build error", () =>
{
    const binding: ConnectorBinding =
    {
        Concept: "a.Order", Connector: "api", Source: "orders", IdKey: "id",
        FieldMap: { id: "id", version: "ver" }, Writable: true, VersionField: "ver",
        Concurrency: WriteConcurrency.Optimistic, Atomicity: WriteAtomicity.Sequential,
    };
    assert.throws(() => ConnectorPlanValidator.Validate(ValidatorHarness.Plan(binding, ValidatorHarness.GraphQl)),
        /cannot version writes/);
});

test("a valid Optimistic binding with an in-map version field on a SQL connector passes plan-build", () =>
{
    const binding: ConnectorBinding =
    {
        Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "id",
        FieldMap: { id: "id", version: "ver" }, Writable: true, VersionField: "ver",
        Concurrency: WriteConcurrency.Optimistic, Atomicity: WriteAtomicity.Transactional,
    };
    assert.doesNotThrow(() => ConnectorPlanValidator.Validate(ValidatorHarness.Plan(binding, ValidatorHarness.Sql)));
});

test("a LastWriteWins binding without a version field passes plan-build", () =>
{
    const binding: ConnectorBinding =
    {
        Concept: "a.Order", Connector: "pg", Source: "order", IdKey: "id",
        FieldMap: { id: "id" }, Writable: true,
        Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential,
    };
    assert.doesNotThrow(() => ConnectorPlanValidator.Validate(ValidatorHarness.Plan(binding, ValidatorHarness.Sql)));
});

class GraphQlWriteConfigHarness
{
    public static Plan(config: Record<string, string>): ModelConnectorPlan
    {
        const connector: ConnectorSpec = { Name: "api", Kind: DataSourceKind.Rest, Config: { style: "graphql", ...config } };
        return { Model: "Sales", Version: "0.0.0", Connectors: [connector], Bindings: [] };
    }
}

test("an invalid GraphQL identifier (input type / arg / return field) is a plan-build error", () =>
{
    assert.throws(() => ConnectorPlanValidator.Validate(GraphQlWriteConfigHarness.Plan({ upsertInputType: "not a type!" })),
        /not a valid GraphQL identifier/);
    assert.throws(() => ConnectorPlanValidator.Validate(GraphQlWriteConfigHarness.Plan({ deleteIdType: "1Bad" })),
        /not a valid GraphQL identifier/);
    assert.throws(() => ConnectorPlanValidator.Validate(GraphQlWriteConfigHarness.Plan({ upsertInputArg: "has-dash" })),
        /not a valid GraphQL identifier/);
    assert.throws(() => ConnectorPlanValidator.Validate(GraphQlWriteConfigHarness.Plan({ deleteIdArg: "" })),
        /not a valid GraphQL identifier/);
    assert.throws(() => ConnectorPlanValidator.Validate(GraphQlWriteConfigHarness.Plan({ upsertReturn: "id total$" })),
        /not a valid GraphQL identifier/);
});

test("valid GraphQL write-config identifiers pass plan-build", () =>
{
    assert.doesNotThrow(() => ConnectorPlanValidator.Validate(GraphQlWriteConfigHarness.Plan({
        upsertInputType: "OrderInput", upsertInputArg: "input", upsertReturn: "id total",
        deleteIdType: "ID", deleteIdArg: "id",
    })));
});

test("a messy error-code list is accepted leniently (empty items ignored, not a plan-build error)", () =>
{
    assert.doesNotThrow(() => ConnectorPlanValidator.Validate(GraphQlWriteConfigHarness.Plan({
        errorConflictCodes: ",,CONFLICT, , DUPLICATE,", errorUnsupportedCodes: "",
    })));
});

test("omitting the GraphQL write-config keys passes plan-build (defaults reproduce at the adapter)", () =>
{
    assert.doesNotThrow(() => ConnectorPlanValidator.Validate(GraphQlWriteConfigHarness.Plan({})));
});

test("write-config identifier rules apply only to GraphQL connectors, not plain REST or SQL", () =>
{
    const sql: ModelConnectorPlan =
    {
        Model: "Sales", Version: "0.0.0",
        Connectors: [{ Name: "pg", Kind: DataSourceKind.Sql, Config: { upsertInputType: "not a type!" } }],
        Bindings: [],
    };
    const rest: ModelConnectorPlan =
    {
        Model: "Sales", Version: "0.0.0",
        Connectors: [{ Name: "svc", Kind: DataSourceKind.Rest, Config: { upsertInputType: "not a type!" } }],
        Bindings: [],
    };
    assert.doesNotThrow(() => ConnectorPlanValidator.Validate(sql));
    assert.doesNotThrow(() => ConnectorPlanValidator.Validate(rest));
});
