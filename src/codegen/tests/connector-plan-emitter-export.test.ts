import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectorPlanEmitter, MetaKind, WriteConcurrency, WriteAtomicity, check } from "@pragmatic-tech-ai/todl";

const META = `
namespace shop {
  concept Customer { name : string; }
  datasource pg { kind = sql; }
  model Shop : shop {
    annotate entrypoint { }
    connect pg;
    populate Customer key customer_id { name = "name"; }
  }
}
`;

const META_WITH_PROVIDER = `
namespace shop {
  concept Customer { name : string; }
  datasource pg { kind = sql; provider = "pg-pack"; }
  model Shop : shop {
    annotate entrypoint { }
    connect pg;
    populate Customer key customer_id { name = "name"; }
  }
}
`;

test("ConnectorPlanEmitter.PlanFor is reachable from the barrel and plans a connector-bearing model", () =>
{
    const { model, diagnostics } = check([{ uri: "shop.todl", text: META }]);
    assert.deepEqual(diagnostics, []);
    const models = model.nodesOfMetaKind(MetaKind.Model);
    let planned = 0;
    for (const id of models)
    {
        const plan = ConnectorPlanEmitter.PlanFor(model, id);
        if (plan !== undefined)
        {
            planned++;
            assert.ok(plan.Bindings.length > 0);
            assert.equal(plan.Connectors.length, 1);
            // The spec carries the fully-qualified connector node id (the catalog memo
            // key) alongside the bare local Name.
            assert.equal(plan.Connectors[0]!.Id, "shop@connector:pg");
            assert.equal(plan.Connectors[0]!.Name, "pg");
            // No provider authored here, so the spec carries none.
            assert.equal(plan.Connectors[0]!.Provider, undefined);
            // Each binding links to its connector by the qualified id, while the bare
            // Connector name is retained for the source/provenance tag.
            assert.equal(plan.Bindings[0]!.Connector, "pg");
            assert.equal(plan.Bindings[0]!.ConnectorId, "shop@connector:pg");
        }
    }
    assert.equal(planned, 1);
});

const META_WITH_WRITE_MODE = `
namespace shop {
  concept Order { total : string; ver : string; }
  datasource pg { kind = sql; }
  model Shop : shop {
    annotate entrypoint { }
    connect pg;
    populate Order key order_id { version ver; concurrency optimistic; atomicity transactional; }
  }
}
`;

const META_GRAPHQL_OPTIMISTIC = `
namespace shop {
  concept Order { total : string; ver : string; }
  datasource api { kind = rest; style = "graphql"; }
  model Shop : shop {
    annotate entrypoint { }
    connect api;
    populate Order key order_id { version ver; concurrency optimistic; }
  }
}
`;

test("omitting the attributes defaults to LastWriteWins + Sequential", () =>
{
    const { model, diagnostics } = check([{ uri: "shop.todl", text: META }]);
    assert.deepEqual(diagnostics, []);
    const [modelId] = model.nodesOfMetaKind(MetaKind.Model);
    const plan = ConnectorPlanEmitter.PlanFor(model, modelId!);
    assert.ok(plan !== undefined);
    const binding = plan!.Bindings[0]!;
    assert.equal(binding.Concurrency, WriteConcurrency.LastWriteWins);
    assert.equal(binding.Atomicity, WriteAtomicity.Sequential);
    assert.equal(binding.VersionField, undefined);
});

test("a binding declaring version+concurrency+atomicity lowers to the right ConnectorBinding", () =>
{
    const { model, diagnostics } = check([{ uri: "shop.todl", text: META_WITH_WRITE_MODE }]);
    assert.deepEqual(diagnostics, []);
    const [modelId] = model.nodesOfMetaKind(MetaKind.Model);
    const plan = ConnectorPlanEmitter.PlanFor(model, modelId!);
    assert.ok(plan !== undefined);
    const binding = plan!.Bindings[0]!;
    assert.equal(binding.Concurrency, WriteConcurrency.Optimistic);
    assert.equal(binding.Atomicity, WriteAtomicity.Transactional);
    // The authored `version` MEMBER is translated to its EXTERNAL field for the plan.
    assert.equal(binding.VersionField, "ver");
    const emitted = ConnectorPlanEmitter.Emit(plan!, "SHOP_PLAN");
    assert.ok(emitted.includes("Concurrency: WriteConcurrency.Optimistic"));
    assert.ok(emitted.includes("Atomicity: WriteAtomicity.Transactional"));
    assert.ok(emitted.includes(`VersionField: "ver"`));
});

test("an Optimistic binding on a GraphQL connector fails plan-build", () =>
{
    const { model, diagnostics } = check([{ uri: "shop.todl", text: META_GRAPHQL_OPTIMISTIC }]);
    assert.deepEqual(diagnostics, []);
    const [modelId] = model.nodesOfMetaKind(MetaKind.Model);
    assert.throws(() => ConnectorPlanEmitter.PlanFor(model, modelId!), /cannot version writes/);
});

test("an authored connector provider survives the plan and is rendered by Emit", () =>
{
    // The default policy forbids a model-declared provider; allow it for this model.
    const { model, diagnostics } = check(
        [{ uri: "shop.todl", text: META_WITH_PROVIDER }], undefined, { InlineAllowed: true, ProviderAllowed: true });
    assert.deepEqual(diagnostics, []);
    const [modelId] = model.nodesOfMetaKind(MetaKind.Model);
    const plan = ConnectorPlanEmitter.PlanFor(model, modelId!);
    assert.ok(plan !== undefined);
    assert.equal(plan!.Connectors[0]!.Provider, "pg-pack");
    const emitted = ConnectorPlanEmitter.Emit(plan!, "SHOP_PLAN");
    assert.ok(emitted.includes(`Provider: "pg-pack"`));
});
