import { test } from "node:test";
import assert from "node:assert/strict";
import { ReflectedEntity, type EntityReader, type EntityHost } from "../reflected-entity.js";

class FakeReader implements EntityReader
{
    constructor(
        readonly id: string,
        readonly concept: string,
        private readonly f: Record<string, string>,
        private readonly t: Record<string, string[]>,
    ) {}

    field(name: string): string | undefined
    {
        return this.f[name];
    }

    targets(member: string): readonly string[]
    {
        return this.t[member] ?? [];
    }
}

class Probe extends ReflectedEntity
{
    label(): string | undefined
    {
        return this.field("label") as string | undefined;
    }

    one(): ReflectedEntity | undefined
    {
        return this.ref("billing");
    }

    many(): readonly ReflectedEntity[]
    {
        return this.refs("availableIn");
    }
}

test("ReflectedEntity reads scalars and follows refs through the host", () =>
{
    const store = new Map<string, ReflectedEntity>();
    const host: EntityHost = { entity: (id) => store.get(id) };
    const target = new Probe(host, new FakeReader("b1", "billing", { label: "Sub" }, {}));
    store.set("b1", target);
    const e = new Probe(host, new FakeReader("t1", "technology", { label: "Copilot" }, { billing: ["b1"], availableIn: ["b1"] }));

    assert.equal(e.id, "t1");
    assert.equal(e.concept, "technology");
    assert.equal(e.label(), "Copilot");
    assert.equal(e.one(), target);
    assert.deepEqual(e.many(), [target]);
});

test("ReflectedEntity.ref returns undefined when the member has no target", () =>
{
    const host: EntityHost = { entity: () => undefined };
    const e = new Probe(host, new FakeReader("t1", "technology", {}, {}));
    assert.equal(e.one(), undefined);
    assert.deepEqual(e.many(), []);
});
