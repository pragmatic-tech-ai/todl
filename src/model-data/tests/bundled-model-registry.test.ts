import { test } from "node:test";
import assert from "node:assert/strict";
import { CompositionRoot } from "@pragmatic-tech-ai/todl-runtime";
import { Repository } from "../../compiler-services/model/model.js";
import { toJSON, type TodlDocument } from "../../compiler-services/emit/json.js";
import type { ReflectedEntity } from "../../reflection-client/reflected-entity.js";
import { BundledModelRegistry, type BundledAppPayload } from "../bundled-model-registry.js";

class Fixtures
{
    // A self-contained shard: one concept `widget` with a single instance, plus a second
    // concept `gadget` with NO instance (to prove empty concepts don't break round-trip).
    public static WidgetShard(instanceId: string): TodlDocument
    {
        const r = new Repository();
        const b = r.builder();
        b.definePrimitive("string");
        b.defineConcept("widget");
        b.addField("widget", "label", "string");
        b.defineConcept("gadget");
        b.addField("gadget", "label", "string");
        b.assertInstance("widget", instanceId);
        b.setField(instanceId, "label", instanceId);
        b.commit();
        return toJSON(r);
    }

    public static Payload(): BundledAppPayload
    {
        return {
            shards: { core: Fixtures.WidgetShard("wc"), ops: Fixtures.WidgetShard("wo") },
            root: "core",
            resources: [{ uri: "x/y.svg", base64: "aGk=" }],   // carried, must not break the build
        };
    }
}

test("From builds a registry whose Root is the designated root model", async () =>
{
    const registry = BundledModelRegistry.From(Fixtures.Payload());
    await registry.PrepareAll(new CompositionRoot().Provider);
    const root = registry.Root();
    assert.notEqual(root, undefined);
    assert.deepEqual(root!.Instances("widget").map((e: ReflectedEntity) => e.id), ["wc"]);
});

test("every root concept round-trips and empty concepts resolve to no instances", async () =>
{
    const registry = BundledModelRegistry.From(Fixtures.Payload());
    await registry.PrepareAll(new CompositionRoot().Provider);
    const root = registry.Root()!;
    assert.deepEqual([...root.ConceptNames()].sort(), ["gadget", "widget"]);
    assert.equal(root.Instances("gadget").length, 0);
    for (const c of root.ConceptNames())
    {
        // round-trip does not throw; concepts with instances return them
        assert.ok(Array.isArray([...root.Instances(c)]));
    }
});
