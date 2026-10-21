import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../api.js";
import { toJSON, fromJSON } from "../emit/json.js";
import { MetaKind } from "../model/kinds.js";

const SRC = `namespace shop
{
    concept Customer { region : string; }
    policy Customer { allow read when principal.region == entity.region; }
    model M : shop { Customer c1 { region = "eu"; } }
}`;

test("a @policy node round-trips through emit and is not surfaced as an instance", () =>
{
    const { model } = check([{ uri: "shop.todl", text: SRC }]);
    const policyIds = model.nodesOfMetaKind(MetaKind.Policy);
    assert.equal(policyIds.length, 1);
    const policyId = policyIds[0]!;
    assert.ok(policyId.endsWith("@policy"));

    const restored = fromJSON(toJSON(model));
    assert.equal(restored.resolve(policyId)!.metaKind, MetaKind.Policy);

    for (const repo of [model, restored])
    {
        const instances = repo.instancesOf("shop.Customer");
        assert.ok(!instances.includes(policyId));
        assert.ok(instances.some((i) => i.endsWith("c1")));
    }
});
