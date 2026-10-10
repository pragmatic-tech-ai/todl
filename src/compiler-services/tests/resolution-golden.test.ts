import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../api.js";
import { EdgeKind, Direction } from "../model/graph.js";
import { toJSON } from "../emit/json.js";

class GoldenFixture
{
    public static readonly UriA = "a.todl";
    public static readonly UriB = "b.todl";
    public static readonly CustomerConcept = "crm.Customer";
    public static readonly LabelKey = "label";
    public static readonly UpdatedAtKey = "updated_at";
    public static readonly ExpectedUpdatedAt = "2024";
    public static readonly ExpectedLabel = "Acme";

    public static readonly A = `namespace crm { concept Customer { email : string; label : string; updated_at : string; }
        identity Customer key email;
        match Customer { same when a.email == b.email; }
        merge Customer { prefer latest for updated_at; }
        model A : crm { Customer a1 { email = "x@y.z"; label = "Acme"; updated_at = "2020"; } } }`;
    public static readonly B = `namespace crm { model B : crm { Customer b1 { email = "x@y.z"; updated_at = "2024"; } } }`;

    public static Run(): ReturnType<typeof check>
    {
        return check([
            { uri: GoldenFixture.UriA, text: GoldenFixture.A },
            { uri: GoldenFixture.UriB, text: GoldenFixture.B },
        ]);
    }

    public static Serialize(model: Parameters<typeof toJSON>[0]): string
    {
        return JSON.stringify(toJSON(model));
    }
}

test("resolving a multi-source fixture is deterministic (byte-stable) and merges correctly", () =>
{
    const first = GoldenFixture.Run();
    const second = GoldenFixture.Run();
    assert.equal(GoldenFixture.Serialize(first.model), GoldenFixture.Serialize(second.model));

    const ids = first.model.instancesOf(GoldenFixture.CustomerConcept);
    assert.equal(ids.length, 1, "one canonical entity");
    const canonical = ids[0]!;
    const attrs = first.model.resolve(canonical)!.attrs;
    assert.equal(attrs.get(GoldenFixture.UpdatedAtKey), GoldenFixture.ExpectedUpdatedAt);
    assert.equal(attrs.get(GoldenFixture.LabelKey), GoldenFixture.ExpectedLabel);
    const members = first.model.related(canonical, EdgeKind.SameAs, Direction.In, null);
    assert.ok(members.length >= 1, "at least one aliased member links by SameAs");
});
