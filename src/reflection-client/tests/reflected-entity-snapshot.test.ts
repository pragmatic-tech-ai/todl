import { test } from "node:test";
import assert from "node:assert/strict";
import { ReflectedEntity } from "../reflected-entity.js";
import type { EntityReader, EntityHost } from "../reflected-entity.js";
import type { Scalar } from "../../manifest/logical.js";

class FakeReader implements EntityReader
{
    public readonly id = "i1";
    public readonly concept = "shop.Customer";
    public field(name: string): Scalar | undefined
    {
        if (name === "name") { return "Acme"; }
        if (name === "score") { return 42; }
        return undefined; // "missing" has no value
    }
    public fieldNames(): readonly string[]
    {
        return ["name", "score", "missing"];
    }
    public targets(): readonly string[]
    {
        return [];
    }
}

const NoHost: EntityHost = { entity: () => undefined };

test("Snapshot returns the entity's defined scalar fields and omits undefined ones", () =>
{
    const entity = new ReflectedEntity(NoHost, new FakeReader());
    assert.deepEqual(entity.Snapshot(), { name: "Acme", score: 42 });
    assert.equal("missing" in entity.Snapshot(), false);
});
