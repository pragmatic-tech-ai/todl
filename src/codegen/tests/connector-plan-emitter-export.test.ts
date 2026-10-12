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
        }
    }
    assert.equal(planned, 1);
});
