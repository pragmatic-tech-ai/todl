import { test } from "node:test";
import assert from "node:assert/strict";

import { check } from "../api.js";
import { EdgeKind, Direction } from "../model/graph.js";
import { toJSON } from "../emit/json.js";
import { Repository } from "../model/model.js";

class GoldenFixture
{
    public static readonly UriA = "a.todl";
    public static readonly UriB = "b.todl";
    public static readonly CustomerConcept = "crm.Customer";
    public static readonly LabelKey = "label";
    public static readonly UpdatedAtKey = "updated_at";
    public static readonly ExpectedUpdatedAt = "2024";
    public static readonly ExpectedLabel = "Acme";
    public static readonly EmailKey = "email";
    public static readonly ExpectedEmail = "x@y.z";

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

    public static RunReversed(): ReturnType<typeof check>
    {
        return check([
            { uri: GoldenFixture.UriB, text: GoldenFixture.B },
            { uri: GoldenFixture.UriA, text: GoldenFixture.A },
        ]);
    }

    public static Serialize(model: Repository): string
    {
        return JSON.stringify(toJSON(model));
    }

    // Order-insensitive projection: nodes sorted by id, attrs sorted by key.
    public static Normalize(model: Repository): string
    {
        const rows = model.allNodes()
            .map((n) => ({
                id: n.id,
                canonicalId: n.canonicalId,
                attrs: [...n.attrs.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)),
            }))
            .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
        return JSON.stringify(rows);
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
    assert.equal(attrs.get(GoldenFixture.EmailKey), GoldenFixture.ExpectedEmail);
    assert.equal(members.length, 1, "exactly one aliased member links by SameAs");
    assert.notEqual(members[0], canonical);
    assert.equal(first.model.resolve(members[0]!)!.canonicalId, canonical);
});

test("resolution outcome is independent of source order", () =>
{
    const forward = GoldenFixture.Run();
    const reversed = GoldenFixture.RunReversed();
    assert.equal(GoldenFixture.Normalize(forward.model), GoldenFixture.Normalize(reversed.model));
    const fwdIds = forward.model.instancesOf(GoldenFixture.CustomerConcept);
    const revIds = reversed.model.instancesOf(GoldenFixture.CustomerConcept);
    assert.deepEqual(revIds, fwdIds);
    assert.deepEqual(
        reversed.model.related(revIds[0]!, EdgeKind.SameAs, Direction.In, null),
        forward.model.related(fwdIds[0]!, EdgeKind.SameAs, Direction.In, null));
});
