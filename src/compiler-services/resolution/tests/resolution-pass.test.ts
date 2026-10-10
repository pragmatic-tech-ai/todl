import { test } from "node:test";
import assert from "node:assert/strict";

import { Repository } from "../../model/model.js";
import { Direction, EdgeKind } from "../../model/graph.js";
import { Builder } from "../../model/builder.js";
import { ResolutionPass } from "../resolution-pass.js";
import { DiagnosticCode } from "../../diagnostics/diagnostic.js";

function seed(): Repository
{
    const model = new Repository();
    const b = model.builder();
    b.setNamespace("n").defineConcept("n.C").addField("n.C", "email", "string");
    b.commit();
    const ib = model.builder();
    ib.setNamespace("n");
    ib.defineIdentity("n.C@identity", "n.C", "email");
    ib.commit();
    return model;
}

function addInstance(model: Repository, id: string, email: string | undefined)
{
    const b = model.builder();
    b.setNamespace("n").assertInstance("n.C", id);
    if (email !== undefined) b.setField(id, "email", email);
    b.commit();
}

test("two instances with the same key collapse to one canonical", () =>
{
    const model = seed();
    addInstance(model, "n.b", "x@y.z");
    addInstance(model, "n.a", "x@y.z");
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);           // lowest id is canonical
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
});

test("different key values are not merged", () =>
{
    const model = seed();
    addInstance(model, "n.a", "a@x.z");
    addInstance(model, "n.b", "b@x.z");
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C").sort(), ["n.a", "n.b"]);
});

test("instances with no key value stay standalone", () =>
{
    const model = seed();
    addInstance(model, "n.a", undefined);
    addInstance(model, "n.b", undefined);
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C").sort(), ["n.a", "n.b"]);
    assert.equal(model.resolve("n.a")!.canonicalId, null);
    assert.equal(model.resolve("n.b")!.canonicalId, null);
});

test("empty-string key values are real values and merge", () =>
{
    const model = seed();
    addInstance(model, "n.b", "");
    addInstance(model, "n.a", "");
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
});

function seedStorageKey(): Repository
{
    const model = new Repository();
    const b = model.builder();
    b.setNamespace("n").defineConcept("n.C");
    b.commit();
    const ib = model.builder();
    ib.setNamespace("n");
    ib.defineIdentity("n.C@identity", "n.C", "storageId");
    ib.commit();
    return model;
}

function addPlain(model: Repository, id: string, storageId: string | null)
{
    const b = model.builder();
    b.setNamespace("n").assertInstance("n.C", id);
    b.commit();
    model.resolve(id)!.storageId = storageId;
}

test("the reserved storageId key merges instances with the same stamped storageId", () =>
{
    const model = seedStorageKey();
    addPlain(model, "n.b", "s1");
    addPlain(model, "n.a", "s1");
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
});

test("the storageId key does not merge unstamped instances", () =>
{
    const model = seedStorageKey();
    addPlain(model, "n.a", null);
    addPlain(model, "n.b", null);
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C").sort(), ["n.a", "n.b"]);
});

test("three instances sharing a key all collapse to one canonical", () =>
{
    const model = seed();
    addInstance(model, "n.c", "k");
    addInstance(model, "n.a", "k");
    addInstance(model, "n.b", "k");
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
    assert.equal(model.resolve("n.c")!.canonicalId, "n.a");
});

test("canonical is the lowest id regardless of insertion order", () =>
{
    const model = seed();
    addInstance(model, "n.z", "k");
    addInstance(model, "n.a", "k");
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
});

test("the pass is idempotent", () =>
{
    const model = seed();
    addInstance(model, "n.a", "k");
    addInstance(model, "n.b", "k");
    const pass = new ResolutionPass(model);
    pass.Resolve();
    pass.Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
});

test("references to an alias are rebound to the canonical", () =>
{
    const model = seed();
    addInstance(model, "n.a", "k");
    addInstance(model, "n.b", "k");
    const rb = model.builder();
    rb.setNamespace("n").defineConcept("n.Ref").addConceptRelationship("n.Ref", "points", ["n.C"]);
    rb.assertInstance("n.Ref", "n.r").addRelationship("n.r", "points", "n.b");
    rb.commit();

    new ResolutionPass(model).Resolve();

    assert.deepEqual(model.related("n.r", EdgeKind.Relationship, Direction.Out, "points"), ["n.a"]);
});

function seedWithMatch(rules: string[][]): Repository
{
    const model = new Repository();
    const b = model.builder();
    b.setNamespace("n").defineConcept("n.C").addField("n.C", "email", "string")
        .addField("n.C", "tax", "string").addField("n.C", "country", "string");
    b.commit();
    const mb = model.builder();
    mb.setNamespace("n");
    mb.defineMatch("n.C@match", "n.C", JSON.stringify(rules));
    mb.commit();
    return model;
}

function addRow(model: Repository, id: string, fields: Record<string, string | number | undefined>)
{
    const b = model.builder();
    b.setNamespace("n").assertInstance("n.C", id);
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) b.setField(id, k, v);
    b.commit();
}

test("two instances matching a rule collapse even with no identity key", () =>
{
    const model = seedWithMatch([["email"]]);
    addRow(model, "n.b", { email: "x@y.z" });
    addRow(model, "n.a", { email: "x@y.z" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
});

test("match rules cluster transitively via union-find", () =>
{
    const model = seedWithMatch([["email"], ["tax"]]);
    addRow(model, "n.a", { email: "same@x.z", tax: "T1" });
    addRow(model, "n.b", { email: "same@x.z", tax: "T2" });
    addRow(model, "n.c", { email: "other@x.z", tax: "T2" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
    assert.equal(model.resolve("n.c")!.canonicalId, "n.a");
});

test("a rule field undefined on one side does not merge", () =>
{
    const model = seedWithMatch([["tax", "country"]]);
    addRow(model, "n.a", { tax: "T", country: "US" });
    addRow(model, "n.b", { tax: "T" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C").sort(), ["n.a", "n.b"]);
});

test("a multi-field rule requires ALL fields to agree", () =>
{
    const model = seedWithMatch([["tax", "country"]]);
    addRow(model, "n.a", { tax: "T", country: "US" });
    addRow(model, "n.b", { tax: "T", country: "CA" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C").sort(), ["n.a", "n.b"]);
});

test("two instances both missing a rule field do not merge on an undefined signature", () =>
{
    const model = seedWithMatch([["tax", "country"]]);
    addRow(model, "n.a", { tax: "T" });
    addRow(model, "n.b", { tax: "T" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C").sort(), ["n.a", "n.b"]);
});

test("a number and a string with the same text do not merge (typeof-prefixed signature)", () =>
{
    const model = seedWithMatch([["tax"]]);
    addRow(model, "n.a", { tax: 1 });
    addRow(model, "n.b", { tax: "1" });
    addRow(model, "n.c", { tax: 1 });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C").sort(), ["n.a", "n.b"]);
    assert.equal(model.resolve("n.c")!.canonicalId, "n.a");
});

test("a corrupt match rules attribute is skipped rather than throwing", () =>
{
    const model = seedWithMatch([["email"]]);
    model.resolve("n.C@match")!.attrs.set(Builder.MatchRulesAttr, "{not json");
    addRow(model, "n.a", { email: "x" });
    addRow(model, "n.b", { email: "x" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C").sort(), ["n.a", "n.b"]);
});

test("identity key and match rule chain: a~b by key, b~c by rule, one canonical", () =>
{
    const model = new Repository();
    const b = model.builder();
    b.setNamespace("n").defineConcept("n.C").addField("n.C", "email", "string").addField("n.C", "tax", "string");
    b.commit();
    const ib = model.builder();
    ib.setNamespace("n");
    ib.defineIdentity("n.C@identity", "n.C", "email");
    ib.defineMatch("n.C@match", "n.C", JSON.stringify([["tax"]]));
    ib.commit();
    addRow(model, "n.a", { email: "e1", tax: "T1" });
    addRow(model, "n.b", { email: "e1", tax: "T2" });
    addRow(model, "n.c", { email: "e3", tax: "T2" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
    assert.equal(model.resolve("n.b")!.canonicalId, "n.a");
    assert.equal(model.resolve("n.c")!.canonicalId, "n.a");
});

function seedWithMerge(rules: object[]): Repository
{
    const model = new Repository();
    const b = model.builder();
    b.setNamespace("n").defineConcept("n.C").addField("n.C", "email", "string")
        .addField("n.C", "label", "string").addField("n.C", "updated_at", "string");
    b.commit();
    const ib = model.builder();
    ib.setNamespace("n");
    ib.defineIdentity("n.C@identity", "n.C", "email");
    ib.defineMerge("n.C@merge", "n.C", JSON.stringify(rules));
    ib.commit();
    return model;
}

test("merge gap-fills: canonical gains a field only the alias had", () =>
{
    const model = seedWithMerge([]);
    addRow(model, "n.a", { email: "x@y.z", label: "A" });
    addRow(model, "n.b", { email: "x@y.z", updated_at: "T2" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.instancesOf("n.C"), ["n.a"]);
    assert.equal(model.resolve("n.a")!.attrs.get("label"), "A");
    assert.equal(model.resolve("n.a")!.attrs.get("updated_at"), "T2");
});

test("merge passes agreeing values through with no diagnostic", () =>
{
    const model = seedWithMerge([]);
    addRow(model, "n.a", { email: "x@y.z", label: "same" });
    addRow(model, "n.b", { email: "x@y.z", label: "same" });
    const diags = new ResolutionPass(model).Resolve();
    assert.equal(model.resolve("n.a")!.attrs.get("label"), "same");
    assert.equal(diags.length, 0);
});

test("a conflict with no rule yields unmerged-conflict and keeps the canonical value", () =>
{
    const model = seedWithMerge([]);
    addRow(model, "n.a", { email: "x@y.z", label: "A" });
    addRow(model, "n.b", { email: "x@y.z", label: "B" });
    const diags = new ResolutionPass(model).Resolve();
    assert.ok(diags.some((d) => d.code === DiagnosticCode.ResolutionUnmergedConflict));
    assert.equal(model.resolve("n.a")!.attrs.get("label"), "A");
});

test("prefer latest picks the greatest value, no diagnostic", () =>
{
    const model = seedWithMerge([{ field: "updated_at", strategy: "latest", source: null }]);
    addRow(model, "n.a", { email: "x@y.z", updated_at: "2020" });
    addRow(model, "n.b", { email: "x@y.z", updated_at: "2024" });
    const diags = new ResolutionPass(model).Resolve();
    assert.equal(model.resolve("n.a")!.attrs.get("updated_at"), "2024");
    assert.equal(diags.filter((d) => d.code === DiagnosticCode.ResolutionUnmergedConflict).length, 0);
});

test("merge unions an alias's outgoing relationship onto the canonical", () =>
{
    const model = seedWithMerge([]);
    addRow(model, "n.a", { email: "x@y.z" });
    addRow(model, "n.b", { email: "x@y.z" });
    const rb = model.builder();
    rb.setNamespace("n").defineConcept("n.T").assertInstance("n.T", "n.t");
    rb.commit();
    model.addEdge({ kind: EdgeKind.Relationship, via: "points", from: "n.b", to: "n.t" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.related("n.a", EdgeKind.Relationship, Direction.Out, "points"), ["n.t"]);
});

function seedPair(rules: object[] = []): Repository
{
    const model = seedWithMerge(rules);
    addRow(model, "n.a", { email: "x@y.z" });
    addRow(model, "n.b", { email: "x@y.z" });
    const rb = model.builder();
    rb.setNamespace("n").defineConcept("n.T").assertInstance("n.T", "n.t");
    rb.commit();
    return model;
}

test("merge dedupes an edge both canonical and alias already have", () =>
{
    const model = seedPair();
    model.addEdge({ kind: EdgeKind.Relationship, via: "points", from: "n.a", to: "n.t" });
    model.addEdge({ kind: EdgeKind.Relationship, via: "points", from: "n.b", to: "n.t" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.related("n.a", EdgeKind.Relationship, Direction.Out, "points"), ["n.t"]);
});

test("merge never creates a self-loop from an alias edge to the canonical", () =>
{
    const model = seedPair();
    model.addEdge({ kind: EdgeKind.Relationship, via: "points", from: "n.b", to: "n.a" });
    new ResolutionPass(model).Resolve();
    assert.ok(!model.related("n.a", EdgeKind.Relationship, Direction.Out, "points").includes("n.a"));
});

test("merge does not fold structural edges onto the canonical", () =>
{
    const model = seedPair();
    model.addEdge({ kind: EdgeKind.Derived, via: "d", from: "n.b", to: "n.t" });
    model.addEdge({ kind: EdgeKind.Narrower, via: null, from: "n.b", to: "n.t" });
    new ResolutionPass(model).Resolve();
    assert.deepEqual(model.related("n.a", EdgeKind.Derived, Direction.Out, "d"), []);
    assert.deepEqual(model.related("n.a", EdgeKind.Narrower, Direction.Out), []);
});

test("prefer source picks the member whose provenance matches", () =>
{
    const model = seedWithMerge([{ field: "label", strategy: "source", source: "crm" }]);
    addRow(model, "n.a", { email: "x@y.z", label: "A" });
    addRow(model, "n.b", { email: "x@y.z", label: "B" });
    const provenance = new Map<string, string>([["n.a", "erp"], ["n.b", "crm"]]);
    const diags = new ResolutionPass(model, provenance).Resolve();
    assert.equal(model.resolve("n.a")!.attrs.get("label"), "B");
    assert.equal(diags.length, 0);
});

test("prefer source is inert without provenance and falls through to a conflict", () =>
{
    const model = seedWithMerge([{ field: "label", strategy: "source", source: "crm" }]);
    addRow(model, "n.a", { email: "x@y.z", label: "A" });
    addRow(model, "n.b", { email: "x@y.z", label: "B" });
    const diags = new ResolutionPass(model).Resolve();
    assert.ok(diags.some((d) => d.code === DiagnosticCode.ResolutionUnmergedConflict));
    assert.equal(model.resolve("n.a")!.attrs.get("label"), "A");
});

test("prefer latest compares numbers numerically (10 beats 9), seeded via the builder", () =>
{
    const model = seedWithMerge([{ field: "rank", strategy: "latest", source: null }]);
    addRow(model, "n.a", { email: "x@y.z", rank: 9 });
    addRow(model, "n.b", { email: "x@y.z", rank: 10 });
    const diags = new ResolutionPass(model).Resolve();
    assert.equal(model.resolve("n.a")!.attrs.get("rank"), 10);
    assert.equal(diags.length, 0);
});

test("a number 1 and a string \"1\" conflict rather than silently merge", () =>
{
    const model = seedWithMerge([]);
    addRow(model, "n.a", { email: "x@y.z", rank: 1 });
    addRow(model, "n.b", { email: "x@y.z", rank: "1" });
    const diags = new ResolutionPass(model).Resolve();
    assert.ok(diags.some((d) => d.code === DiagnosticCode.ResolutionUnmergedConflict));
    assert.equal(model.resolve("n.a")!.attrs.get("rank"), 1);
});

test("merge reads raw attrs: a class-fixed value is not treated as an authored instance value", () =>
{
    const model = seedWithMerge([]);
    const kb = model.builder();
    kb.setNamespace("n").assertInstance("n.C", "n.K", true).setField("n.K", "label", "fixed");
    kb.commit();
    addRow(model, "n.a", { email: "x@y.z" });
    addRow(model, "n.b", { email: "x@y.z" });
    const ib = model.builder();
    ib.addInstanceOf("n.a", "n.K").addInstanceOf("n.b", "n.K");
    ib.commit();
    const diags = new ResolutionPass(model).Resolve();
    assert.equal(diags.length, 0);
    assert.equal(model.resolve("n.a")!.attrs.get("label"), undefined);
    assert.equal(model.effectiveFields("n.a").get("label"), "fixed");
});

test("a second Resolve returns no diagnostics and leaves attrs and edges unchanged", () =>
{
    const model = seedPair();
    addRow(model, "n.c", { email: "x@y.z", label: "L" });
    model.addEdge({ kind: EdgeKind.Relationship, via: "points", from: "n.b", to: "n.t" });
    const pass = new ResolutionPass(model);
    pass.Resolve();
    const attrs = [...model.resolve("n.a")!.attrs.entries()];
    const edges = model.related("n.a", EdgeKind.Relationship, Direction.Out, "points");
    assert.deepEqual(pass.Resolve(), []);
    assert.deepEqual([...model.resolve("n.a")!.attrs.entries()], attrs);
    assert.deepEqual(model.related("n.a", EdgeKind.Relationship, Direction.Out, "points"), edges);
});
