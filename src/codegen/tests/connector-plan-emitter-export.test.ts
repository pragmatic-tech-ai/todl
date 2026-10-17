import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectorPlanEmitter, MetaKind, check } from "@pragmatic-tech-ai/todl";

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
        }
    }
    assert.equal(planned, 1);
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
