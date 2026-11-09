import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../compiler-services/api.js";
import { toJSON, type TodlDocument } from "../../compiler-services/emit/json.js";
import { DataSourceKind, WriteAtomicity, WriteConcurrency, type ConnectorBinding, type ModelConnectorPlan } from "../connector-plan.js";
import { MergeFreeConcepts } from "../merge-free-concepts.js";

class MergeFixture
{
    public static Base(extra: string = ""): TodlDocument
    {
        const text = `namespace shop { concept Party { name : string?; } concept Customer : Party { region : string?; } concept Order { status : string?; } ${extra} }`;
        return toJSON(check([{ uri: "shop.todl", text }]).model);
    }

    public static Binding(concept: string, source: string): ConnectorBinding
    {
        return { Concept: concept, Connector: "db", Source: source, IdKey: "id", FieldMap: { id: "id" }, Writable: false, Concurrency: WriteConcurrency.LastWriteWins, Atomicity: WriteAtomicity.Sequential };
    }

    public static Plan(...bindings: ConnectorBinding[]): ModelConnectorPlan
    {
        return { Model: "shop", Version: "1", Connectors: [{ Name: "db", Kind: DataSourceKind.Sql, Config: {} }], Bindings: bindings };
    }

    public static Free(plan: ModelConnectorPlan, base: TodlDocument): string[]
    {
        return [...MergeFreeConcepts.Of(plan, base)].sort();
    }
}

test("singly bound concepts with storageId identity and no authored instances are merge-free", () =>
{
    const plan = MergeFixture.Plan(MergeFixture.Binding("shop.Customer", "c"), MergeFixture.Binding("shop.Order", "o"));
    assert.deepEqual(MergeFixture.Free(plan, MergeFixture.Base("identity Customer key storageId;")), ["shop.Customer", "shop.Order"]);
});

test("two bindings in one type family (same concept or sub/supertype) are not merge-free", () =>
{
    const same = MergeFixture.Plan(MergeFixture.Binding("shop.Customer", "a"), MergeFixture.Binding("shop.Customer", "b"), MergeFixture.Binding("shop.Order", "o"));
    assert.deepEqual(MergeFixture.Free(same, MergeFixture.Base()), ["shop.Order"]);
    const family = MergeFixture.Plan(MergeFixture.Binding("shop.Customer", "a"), MergeFixture.Binding("shop.Party", "p"));
    assert.deepEqual(MergeFixture.Free(family, MergeFixture.Base()), []);
});

test("a hand-authored instance in the family, a non-storageId identity, or any match rule disables push-down", () =>
{
    const plan = MergeFixture.Plan(MergeFixture.Binding("shop.Customer", "c"), MergeFixture.Binding("shop.Order", "o"));
    const authored = MergeFixture.Base("model M : shop { Customer c1 { region = \"eu\"; } }");
    assert.deepEqual(MergeFixture.Free(plan, authored), ["shop.Order"]);
    assert.deepEqual(MergeFixture.Free(plan, MergeFixture.Base("identity Customer key region;")), []);
    assert.deepEqual(MergeFixture.Free(plan, MergeFixture.Base("match Order { same when a.status == b.status; }")), []);
});
