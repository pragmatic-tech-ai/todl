import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeStorage } from "@pragmatic-tech-ai/todl-runtime";
import { SolutionGraph, type SolutionGraphMember } from "../solution-graph.js";
import type { TodlDocument } from "../../../../compiler-services/emit/json.js";
import { DiagnosticCode } from "../../../../compiler-services/validate/validate.js";

const MODEL = `namespace shop
{
    concept Customer { email : string; label : string; updated_at : string; }
    identity Customer key email;
    merge Customer { prefer latest for updated_at; }

    model Book : shop
    {
        Customer a { email = "x@y.z"; label = "Acme"; updated_at = "2020"; }
        Customer b { email = "x@y.z"; updated_at = "2024"; }
    }
}`;

class MemberFixture
{
    static one(text: string): SolutionGraphMember
    {
        return { id: "arch", storage: new FakeStorage(), sources: [{ uri: "shop.todl", text }], baseIds: [], publishedBases: [] as TodlDocument[] };
    }
}

test("Build resolves the model to one canonical and fires Changed", async () =>
{
    const g = new SolutionGraph();
    let fired = false;
    g.Changed.subscribe(() => { fired = true; });
    await g.Build([MemberFixture.one(MODEL)]);
    assert.ok(fired, "Changed must emit after a resolving build");
    const ids = g.Model.instancesOf("shop.Customer");
    assert.equal(ids.length, 1);
    assert.equal(g.Model.resolve(ids[0]!)!.attrs.get("updated_at"), "2024");
    assert.equal(g.Model.resolve(ids[0]!)!.attrs.get("label"), "Acme");
    const aliased = g.Model.allNodes().filter((n) => n.canonicalId === ids[0] && n.id !== ids[0]);
    assert.ok(aliased.length >= 1, "a merged-away instance must be aliased to the canonical");
});

test("a conflicting field with no rule surfaces resolution.unmerged-conflict in diagnostics", async () =>
{
    const conflict = `namespace shop
{
    concept Customer { email : string; label : string; }
    identity Customer key email;

    model Book : shop
    {
        Customer a { email = "x@y.z"; label = "Acme"; }
        Customer b { email = "x@y.z"; label = "Beta"; }
    }
}`;
    const g = new SolutionGraph();
    await g.Build([MemberFixture.one(conflict)]);
    const all = [...g.DiagnosticsByUri().values()].flat();
    assert.ok(all.some((d) => d.code === DiagnosticCode.ResolutionUnmergedConflict));
});

test("ReplaceFile on a resolution solution rebuilds to a correct single canonical", async () =>
{
    const g = new SolutionGraph();
    await g.Build([MemberFixture.one(MODEL)]);
    const emits: { memberIds: readonly string[] }[] = [];
    g.Changed.subscribe((c) => { emits.push(c); });
    g.ReplaceFile("shop.todl", [{ uri: "shop.todl", text: MODEL.replace(`"2024"`, `"2030"`) }]);
    assert.equal(emits.length, 1);
    assert.deepEqual(emits[0]!.memberIds, ["arch"]);
    const ids = g.Model.instancesOf("shop.Customer");
    assert.equal(ids.length, 1);
    assert.equal(g.Model.resolve(ids[0]!)!.attrs.get("updated_at"), "2030");
});

test("ReplaceMember on a resolution solution rebuilds to one canonical with the edited value", async () =>
{
    const g = new SolutionGraph();
    await g.Build([MemberFixture.one(MODEL)]);
    g.ReplaceMember("arch", [{ uri: "shop.todl", text: MODEL.replace(`"2024"`, `"2031"`) }]);
    const ids = g.Model.instancesOf("shop.Customer");
    assert.equal(ids.length, 1);
    assert.equal(g.Model.resolve(ids[0]!)!.attrs.get("updated_at"), "2031");
});

test("a bad edit on a resolution solution repairs to last-good and a later good edit still works", async () =>
{
    const g = new SolutionGraph();
    await g.Build([MemberFixture.one(MODEL)]);
    const bad = { uri: "shop.todl", text: "namespace shop { concept Dup { } concept Dup { } }" };
    assert.doesNotThrow(() => g.ReplaceMember("arch", [bad]));
    let ids = g.Model.instancesOf("shop.Customer");
    assert.equal(ids.length, 1);
    assert.equal(g.Model.resolve(ids[0]!)!.attrs.get("updated_at"), "2024");
    assert.doesNotThrow(() => g.ReplaceFile("shop.todl", [{ uri: "shop.todl", text: MODEL.replace(`"2024"`, `"2032"`) }]));
    ids = g.Model.instancesOf("shop.Customer");
    assert.equal(ids.length, 1);
    assert.equal(g.Model.resolve(ids[0]!)!.attrs.get("updated_at"), "2032");
});
