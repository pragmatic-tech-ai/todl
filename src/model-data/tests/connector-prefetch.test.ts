import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { DataSourceKind, type ConnectorBinding, type ConnectorSpec, type ModelConnectorPlan, type ResolvedConnection } from "../connector-plan.js";
import { DataSourceAdapterCatalog } from "../data-source-adapter-catalog.js";
import type { IDataSourceAdapter, IDataSourceAdapterFactory } from "../data-source-adapter.js";
import { ConnectorPrefetch, type INodeReflector } from "../connector-prefetch.js";
import { ConnectorMirrorMapper } from "../connector-mirror-mapper.js";
import {
    ConnectorResolutionDiagnosticSinkKey,
    ConnectorResolutionIssue,
    type ConnectorResolutionDiagnostic,
    type IConnectorResolutionDiagnosticSink,
} from "../connector-resolution-diagnostic-sink.js";
import type { InstanceMirror, ReflectedNode } from "../../manifest/reflection/reflection.js";
import type { ExternalRecord, QueryRequest, WriteBatch, WriteResult } from "../connector-plan.js";
import { InMemoryAdapterFactory } from "./fakes.js";

class StubReflector implements INodeReflector
{
    public reflect(node: ReflectedNode): InstanceMirror
    {
        return { node } as unknown as InstanceMirror;
    }
}

class ThrowingFactory implements IDataSourceAdapterFactory
{
    public constructor(public readonly Kind: DataSourceKind)
    {
    }

    public async Open(_connection: ResolvedConnection): Promise<IDataSourceAdapter>
    {
        throw new Error("cannot open");
    }
}

class RecordingAdapter implements IDataSourceAdapter
{
    public LastRequest: QueryRequest | undefined;

    public async Query(request: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        this.LastRequest = request;
        return [];
    }

    public async Apply(_batch: WriteBatch): Promise<WriteResult>
    {
        return { Applied: 0, Conflicts: [] };
    }

    public async Dispose(): Promise<void>
    {
    }
}

class RecordingFactory implements IDataSourceAdapterFactory
{
    public readonly Adapter = new RecordingAdapter();

    public constructor(public readonly Kind: DataSourceKind)
    {
    }

    public async Open(_connection: ResolvedConnection): Promise<IDataSourceAdapter>
    {
        return this.Adapter;
    }
}

class RejectingAdapter extends RecordingAdapter
{
    public static readonly Message = "query exploded";

    public override async Query(_request: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        throw new Error(RejectingAdapter.Message);
    }
}

class RejectingFactory extends RecordingFactory
{
    public override readonly Adapter = new RejectingAdapter();
}

class RecordingDiagnosticSink implements IConnectorResolutionDiagnosticSink
{
    public readonly Diagnostics: ConnectorResolutionDiagnostic[] = [];

    public async Record(diagnostic: ConnectorResolutionDiagnostic): Promise<void>
    {
        this.Diagnostics.push(diagnostic);
    }
}

class Fixture
{
    public static readonly Concept = "ns.Widget";
    public static readonly Spec: ConnectorSpec = { Name: "pg", Kind: DataSourceKind.Sql, Config: {} };
    public static readonly Binding: ConnectorBinding =
    {
        Concept: Fixture.Concept,
        Connector: "pg",
        Source: "widgets",
        IdKey: "pk",
        FieldMap: { id: "pk", label: "name" },
        Writable: false,
    };
    public static readonly Plan: ModelConnectorPlan =
    {
        Model: "m",
        Version: "1",
        Connectors: [Fixture.Spec],
        Bindings: [Fixture.Binding],
    };
}

test("prefetch mints a mirror per record with mapped attrs and the synthetic id", async () =>
{
    const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
    factory.Adapter.Seed("widgets", [{ pk: "1", name: "Alpha" }, { pk: "2", name: "Beta" }]);
    const catalog = new DataSourceAdapterCatalog().Register(factory);

    const snapshot = await ConnectorPrefetch.ForConcepts([Fixture.Concept], Fixture.Plan, catalog, new ServiceProvider(), new StubReflector());

    const mirrors = snapshot.get(Fixture.Concept)!;
    assert.equal(mirrors.length, 2);
    assert.equal(mirrors[0]!.node.id, "ns.Widget#pg.widgets#1");
    assert.equal(mirrors[0]!.node.type, "ns.Widget");
    assert.equal(mirrors[0]!.node.namespace, "ns");
    assert.deepEqual(mirrors[0]!.node.attrs, { label: "Alpha" });
    assert.deepEqual(mirrors[1]!.node.attrs, { label: "Beta" });
});

test("prefetch is fail-closed when the adapter cannot be opened", async () =>
{
    const catalog = new DataSourceAdapterCatalog().Register(new ThrowingFactory(DataSourceKind.Sql));

    const snapshot = await ConnectorPrefetch.ForConcepts([Fixture.Concept], Fixture.Plan, catalog, new ServiceProvider(), new StubReflector());

    assert.deepEqual(snapshot.get(Fixture.Concept), []);
});

test("prefetch records an Unresolved diagnostic when the adapter cannot be opened", async () =>
{
    const catalog = new DataSourceAdapterCatalog().Register(new ThrowingFactory(DataSourceKind.Sql));
    const sink = new RecordingDiagnosticSink();
    const services = new ServiceProvider();
    services.registerInstance(ConnectorResolutionDiagnosticSinkKey, sink);

    const snapshot = await ConnectorPrefetch.ForConcepts([Fixture.Concept], Fixture.Plan, catalog, services, new StubReflector());

    assert.deepEqual(snapshot.get(Fixture.Concept), []);
    assert.deepEqual(sink.Diagnostics, [
        { concept: Fixture.Concept, connector: "pg", source: "widgets", issue: ConnectorResolutionIssue.Unresolved },
    ]);
});

test("prefetch records NO diagnostic when a resolved adapter simply returns no rows", async () =>
{
    // RecordingFactory's adapter resolves but Query() returns []: a genuinely empty source,
    // which must read apart from the unresolved case — no diagnostic.
    const catalog = new DataSourceAdapterCatalog().Register(new RecordingFactory(DataSourceKind.Sql));
    const sink = new RecordingDiagnosticSink();
    const services = new ServiceProvider();
    services.registerInstance(ConnectorResolutionDiagnosticSinkKey, sink);

    const snapshot = await ConnectorPrefetch.ForConcepts([Fixture.Concept], Fixture.Plan, catalog, services, new StubReflector());

    assert.deepEqual(snapshot.get(Fixture.Concept), []);
    assert.equal(sink.Diagnostics.length, 0);
});

test("prefetch skips concepts with no binding and de-duplicates requests", async () =>
{
    const factory = new InMemoryAdapterFactory(DataSourceKind.Sql);
    factory.Adapter.Seed("widgets", [{ pk: "1", name: "Alpha" }]);
    const catalog = new DataSourceAdapterCatalog().Register(factory);

    const snapshot = await ConnectorPrefetch.ForConcepts(["ns.Native", Fixture.Concept, Fixture.Concept], Fixture.Plan, catalog, new ServiceProvider(), new StubReflector());

    assert.equal(snapshot.size, 1);
    assert.equal(snapshot.get(Fixture.Concept)!.length, 1);
});

test("mapper drops records lacking an id", () =>
{
    assert.equal(ConnectorMirrorMapper.NodeFor(Fixture.Binding, { name: "x" }), undefined);
    assert.equal(ConnectorMirrorMapper.NodeFor(Fixture.Binding, { pk: null, name: "x" }), undefined);
});

test("prefetch sends the binding's source and a deduped, sorted field list", async () =>
{
    const factory = new RecordingFactory(DataSourceKind.Sql);
    const catalog = new DataSourceAdapterCatalog().Register(factory);
    const binding: ConnectorBinding = { ...Fixture.Binding, FieldMap: { id: "pk", label: "name", alias: "name", z: "zeta" } };
    const plan: ModelConnectorPlan = { ...Fixture.Plan, Bindings: [binding] };

    await ConnectorPrefetch.ForConcepts([Fixture.Concept], plan, catalog, new ServiceProvider(), new StubReflector());

    assert.equal(factory.Adapter.LastRequest!.Source, "widgets");
    assert.deepEqual(factory.Adapter.LastRequest!.Fields, ["name", "pk", "zeta"]);
});

test("a resolved adapter whose Query rejects propagates the error (not fail-closed)", async () =>
{
    const catalog = new DataSourceAdapterCatalog().Register(new RejectingFactory(DataSourceKind.Sql));

    await assert.rejects(
        ConnectorPrefetch.ForConcepts([Fixture.Concept], Fixture.Plan, catalog, new ServiceProvider(), new StubReflector()),
        /query exploded/);
});
