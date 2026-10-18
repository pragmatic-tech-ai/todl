import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "../../compiler-services/api.js";
import { CypherEngine } from "../../cypher/engine.js";
import { ModelDraft } from "../model-draft.js";
import { ModelDraftBaker } from "../model-draft-baker.js";

class BakerFixture
{
    public static readonly Meta = { uri: "shop.todl", text: "namespace shop { concept Customer { name : string?; } }" };
    public static readonly Model = `namespace app { import shop; model M : shop { Customer c1 { name = "Ada"; } } }`;
    public static readonly Query = "MATCH (n:shop.Customer) RETURN n";

    public static Draft(): ModelDraft
    {
        return ModelDraft.fromSource([check([BakerFixture.Meta]).model], BakerFixture.Model, { namespace: "app" });
    }

    public static Count(draft: ModelDraft, opts?: { model?: string; version?: string }): number
    {
        return new CypherEngine(ModelDraftBaker.Bake(draft, opts)).Execute(BakerFixture.Query).Rows.length;
    }
}

test("Bake exposes the draft's instances to Cypher", () =>
{
    assert.equal(BakerFixture.Count(BakerFixture.Draft()), 1);
});

test("a re-bake after a draft mutation reflects the new instance", () =>
{
    const draft = BakerFixture.Draft();
    const before = ModelDraftBaker.Bake(draft);
    draft.create("shop.Customer", "app.c2");
    assert.equal(BakerFixture.Count(draft), 2);
    assert.equal(new CypherEngine(before).Execute(BakerFixture.Query).Rows.length, 1);
});

test("model and version options override the defaults", () =>
{
    assert.equal(BakerFixture.Count(BakerFixture.Draft(), { model: "custom", version: "9.9.9" }), 1);
});

test("BakeQuery returns a directly queryable IGraphQuery and Bake adapts the same recipe", () =>
{
    const draft = BakerFixture.Draft();
    const query = ModelDraftBaker.BakeQuery(draft);
    assert.deepEqual(query.InstancesOf("shop.Customer").map((m) => m.node.id), ["app.c1"]);
    const viaAdapter = ModelDraftBaker.Bake(draft).NodesByLabel("shop.Customer").map((m) => m.node.id);
    assert.deepEqual(viaAdapter, ["app.c1"]);
});
