import { test } from "node:test";
import assert from "node:assert/strict";

import { load } from "../../../../compiler-services/parse/loader.js";
import { ScopedRepository } from "../scoped-repository.js";

class ScopedHarness
{
    public static readonly Source = `namespace t {
concept loc { }
aspect placed { relationship in -> loc?; }
aspect hidden { secret : string; }
concept net : placed, hidden { }
net n1 { secret = "x"; }
}`;

    public static Scoped(hiddenIds: string[]): ScopedRepository
    {
        const model = load([{ uri: "t.todl", text: ScopedHarness.Source }]).model;
        const visible = new Set(model.allNodes().map((n) => n.id).filter((id) => !hiddenIds.some((h) => id === h || id.startsWith(`${h}.`))));
        return new ScopedRepository(model, visible, visible);
    }
}

test("scoped effectiveSchema and aspect queries include visible aspects", () =>
{
    const s = ScopedHarness.Scoped(["t.hidden"]);
    assert.deepEqual(s.AspectsOf("t.net"), ["t.placed"]);
    assert.deepEqual(s.effectiveSchema("t.net").relationships.map((r) => r.name), ["in"]);
    assert.deepEqual(s.effectiveSchema("t.net").fields.map((f) => f.name), []);
    assert.deepEqual(s.CarriersOf("t.placed"), ["t.net"]);
    assert.equal(s.IsA("t.net", "t.placed"), true);
    assert.equal(s.IsA("t.net", "t.hidden"), false);
    assert.deepEqual(s.InstancesMatching("t.placed").map((n) => n.id), ["t.n1"]);
    assert.deepEqual(s.InstancesMatching("t.hidden"), []);
});

test("scoped view with everything visible sees all aspect members", () =>
{
    const s = ScopedHarness.Scoped([]);
    assert.deepEqual(s.effectiveSchema("t.net").fields.map((f) => f.name), ["secret"]);
    assert.deepEqual([...s.AspectsOf("t.net")].sort(), ["t.hidden", "t.placed"]);
});
