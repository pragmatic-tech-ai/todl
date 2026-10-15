import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectorRuntimeGraphQuery } from "../connector-runtime-graph-query.js";
import type { IGraphQuery } from "../graph-query.js";
import type { InstanceMirror, TermInfo, TypeInfo } from "../../manifest/reflection/reflection.js";

class Stub
{
    public static Mirror(id: string): InstanceMirror
    {
        return { node: { id, type: "t", attrs: {} } } as unknown as InstanceMirror;
    }
}

class FakeBase implements IGraphQuery
{
    public static readonly NativeConcept = "ns.Native";
    public static readonly NativeId = "ns.Native#1";

    public readonly Native = Stub.Mirror(FakeBase.NativeId);
    public readonly Calls: string[] = [];

    private readonly type = { tag: "type" } as unknown as TypeInfo;
    private readonly term = { tag: "term" } as unknown as TermInfo;

    public Concepts(): TypeInfo[] { this.Calls.push("Concepts"); return [this.type]; }
    public Type(_name: string): TypeInfo | undefined { this.Calls.push("Type"); return this.type; }
    public InstancesOf(_conceptId: string): InstanceMirror[] { this.Calls.push("InstancesOf"); return [this.Native]; }
    public Reflect(id: string): InstanceMirror | undefined { this.Calls.push("Reflect"); return id === FakeBase.NativeId ? this.Native : undefined; }
    public Refs(_id: string, _member: string): InstanceMirror[] { this.Calls.push("Refs"); return [this.Native]; }
    public Referrers(_id: string, _member?: string): InstanceMirror[] { this.Calls.push("Referrers"); return [this.Native]; }
    public Search(_text: string): InstanceMirror[] { this.Calls.push("Search"); return [this.Native]; }
    public AllInstances(): InstanceMirror[] { this.Calls.push("AllInstances"); return [this.Native]; }
    public Term(_id: string): TermInfo | undefined { this.Calls.push("Term"); return this.term; }
    public Narrower(_termId: string): TermInfo[] { this.Calls.push("Narrower"); return [this.term]; }
    public Broader(_termId: string): TermInfo[] { this.Calls.push("Broader"); return [this.term]; }
    public Descendants(_termId: string): TermInfo[] { this.Calls.push("Descendants"); return [this.term]; }
    public Ancestors(_termId: string): TermInfo[] { this.Calls.push("Ancestors"); return [this.term]; }
    public IconKey(_typeId: string): string | undefined { this.Calls.push("IconKey"); return "icon"; }
}

class Fixture
{
    public static readonly ConnectorConcept = "ns.Widget";
    public static readonly SyntheticId = "ns.Widget#pg.widgets#1";

    public static Snapshot(): Map<string, InstanceMirror[]>
    {
        return new Map([[Fixture.ConnectorConcept, [Stub.Mirror(Fixture.SyntheticId)]]]);
    }
}

test("connector concept is served from the snapshot; native concept delegates", () =>
{
    const base = new FakeBase();
    const query = new ConnectorRuntimeGraphQuery(base, Fixture.Snapshot());

    assert.equal(query.InstancesOf(Fixture.ConnectorConcept)[0]!.node.id, Fixture.SyntheticId);
    assert.deepEqual(base.Calls, []);
    assert.equal(query.InstancesOf(FakeBase.NativeConcept)[0], base.Native);
    assert.deepEqual(base.Calls, ["InstancesOf"]);
});

test("default-backed concept unions base instances with the snapshot", () =>
{
    const base = new FakeBase();
    const query = new ConnectorRuntimeGraphQuery(base, Fixture.Snapshot(), new Set([Fixture.ConnectorConcept]));

    const ids = query.InstancesOf(Fixture.ConnectorConcept).map(m => m.node.id).sort();
    assert.deepEqual(ids, [FakeBase.NativeId, Fixture.SyntheticId].sort());
});

test("non-default (external) concept in snapshot still shadows base", () =>
{
    const query = new ConnectorRuntimeGraphQuery(new FakeBase(), Fixture.Snapshot(), new Set());

    assert.deepEqual(query.InstancesOf(Fixture.ConnectorConcept).map(m => m.node.id), [Fixture.SyntheticId]);
});

test("omitting defaultConcepts preserves SP-3c(1) behavior (regression)", () =>
{
    const base = new FakeBase();
    const query = new ConnectorRuntimeGraphQuery(base, Fixture.Snapshot());

    assert.deepEqual(query.InstancesOf(Fixture.ConnectorConcept).map(m => m.node.id), [Fixture.SyntheticId]);
    assert.deepEqual(base.Calls, []);
});

test("AllInstances unions base and snapshot", () =>
{
    const query = new ConnectorRuntimeGraphQuery(new FakeBase(), Fixture.Snapshot());

    assert.deepEqual(query.AllInstances().map(m => m.node.id), [FakeBase.NativeId, Fixture.SyntheticId]);
});

test("Reflect finds snapshot ids and delegates otherwise", () =>
{
    const base = new FakeBase();
    const query = new ConnectorRuntimeGraphQuery(base, Fixture.Snapshot());

    assert.equal(query.Reflect(Fixture.SyntheticId)!.node.id, Fixture.SyntheticId);
    assert.deepEqual(base.Calls, []);
    assert.equal(query.Reflect(FakeBase.NativeId), base.Native);
    assert.deepEqual(base.Calls, ["Reflect"]);
});

test("an empty snapshot delegates every method to the base", () =>
{
    const base = new FakeBase();
    const query = new ConnectorRuntimeGraphQuery(base, new Map());

    query.InstancesOf(FakeBase.NativeConcept);
    query.AllInstances();
    query.Reflect(FakeBase.NativeId);
    query.Refs("a", "m");
    query.Referrers("a", "m");
    query.Search("x");
    query.Concepts();
    query.Type("t");
    query.Term("x");
    query.Narrower("x");
    query.Broader("x");
    query.Descendants("x");
    query.Ancestors("x");
    assert.equal(query.IconKey("t"), "icon");

    assert.deepEqual(base.Calls, [
        "InstancesOf", "AllInstances", "Reflect", "Refs", "Referrers", "Search", "Concepts",
        "Type", "Term", "Narrower", "Broader", "Descendants", "Ancestors", "IconKey",
    ]);
    assert.deepEqual(query.AllInstances().map(m => m.node.id), [FakeBase.NativeId]);
});

test("Refs, Referrers, Search and schema delegate even with a populated snapshot", () =>
{
    const base = new FakeBase();
    const query = new ConnectorRuntimeGraphQuery(base, Fixture.Snapshot());

    assert.equal(query.Refs("a", "m")[0], base.Native);
    assert.equal(query.Referrers("a")[0], base.Native);
    assert.equal(query.Search("x")[0], base.Native);
    assert.equal(query.Concepts().length, 1);
    assert.deepEqual(base.Calls, ["Refs", "Referrers", "Search", "Concepts"]);
});
