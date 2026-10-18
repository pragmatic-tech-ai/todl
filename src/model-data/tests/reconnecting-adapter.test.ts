import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectionFailureKind } from "../connection-reconnect.js";
import type { ConnectionRetryPolicy, IReconnectObserver, ReconnectEvent } from "../connection-reconnect.js";
import { WriteFailureKind } from "../connector-plan.js";
import type { ExternalRecord, QueryRequest, WriteBatch, WriteResult } from "../connector-plan.js";
import type { IDataSourceAdapter } from "../data-source-adapter.js";
import { ReconnectingAdapter } from "../reconnecting-adapter.js";

class TaggedError extends Error
{
    public constructor(message: string, public readonly Kind: ConnectionFailureKind)
    {
        super(message);
    }
}

type ScriptedAction = { Throw: ConnectionFailureKind; Message?: string } | { Return: unknown };

class ScriptedAdapter implements IDataSourceAdapter
{
    private static readonly DefaultMessage = "scripted failure";
    private static readonly ExhaustedMessage = "script exhausted";

    public DisposeCount = 0;
    public CanTransact = false;
    public CanVersion = false;
    private readonly actions: ScriptedAction[];
    private readonly repeatLast: boolean;

    public constructor(actions: ScriptedAction[], repeatLast = false)
    {
        this.actions = actions;
        this.repeatLast = repeatLast;
    }

    public async Query(_request: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        return (await this.Next()) as readonly ExternalRecord[];
    }

    public async Apply(_batch: WriteBatch): Promise<WriteResult>
    {
        return (await this.Next()) as WriteResult;
    }

    public async Dispose(): Promise<void>
    {
        this.DisposeCount++;
    }

    public ClassifyFailure(error: unknown): ConnectionFailureKind
    {
        return (error as TaggedError).Kind;
    }

    private async Next(): Promise<unknown>
    {
        const action = this.repeatLast && this.actions.length === 1 ? this.actions[0] : this.actions.shift();
        if (!action)
        {
            throw new Error(ScriptedAdapter.ExhaustedMessage);
        }
        if ("Throw" in action)
        {
            throw new TaggedError(action.Message ?? ScriptedAdapter.DefaultMessage, action.Throw);
        }
        return action.Return;
    }
}

class ReconnectingAdapterFixture
{
    public static readonly Policy: ConnectionRetryPolicy = { InitialDelayMs: 200, Factor: 2, MaxDelayMs: 2000, MaxAttempts: 3 };
    public static readonly Request = {} as QueryRequest;
    public static readonly Batch = {} as WriteBatch;
    public static readonly Rows = [{ id: 1 }] as unknown as readonly ExternalRecord[];
    public static readonly Secret = "s3cr3t-token-xyz";
    public static readonly ConnectorName = "orders";
    public static readonly NoMoreMessage = "no more adapters";

    public ReopenCount = 0;
    public readonly Reopened: ScriptedAdapter[];

    public constructor(reopened: ScriptedAdapter[])
    {
        this.Reopened = reopened;
    }

    public Reopen = async (): Promise<IDataSourceAdapter> =>
    {
        this.ReopenCount++;
        await new Promise<void>((resolve) => setImmediate(resolve));
        const next = this.Reopened.shift();
        if (!next)
        {
            throw new Error(ReconnectingAdapterFixture.NoMoreMessage);
        }
        return next;
    };

    public Build(inner: IDataSourceAdapter, observer?: IReconnectObserver): ReconnectingAdapter
    {
        return new ReconnectingAdapter(
            ReconnectingAdapterFixture.ConnectorName,
            inner,
            this.Reopen,
            ReconnectingAdapterFixture.Policy,
            observer,
            () => 0,
            async () => { },
        );
    }

    public static Conflict(): WriteResult
    {
        return { Applied: 0, Failures: [{ Key: "a", Kind: WriteFailureKind.Conflict, Reason: "stale" }] };
    }
}

test("a transient then success retries the same adapter without reopening", async () =>
{
    const inner = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Transient }, { Return: ReconnectingAdapterFixture.Rows }]);
    const fixture = new ReconnectingAdapterFixture([]);
    const rows = await fixture.Build(inner).Query(ReconnectingAdapterFixture.Request);
    assert.equal(rows, ReconnectingAdapterFixture.Rows);
    assert.equal(fixture.ReopenCount, 0);
});

test("two transients then success reopens exactly once", async () =>
{
    const inner1 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Transient }, { Throw: ConnectionFailureKind.Transient }]);
    const inner2 = new ScriptedAdapter([{ Return: ReconnectingAdapterFixture.Rows }]);
    const fixture = new ReconnectingAdapterFixture([inner2]);
    const rows = await fixture.Build(inner1).Query(ReconnectingAdapterFixture.Request);
    assert.equal(rows, ReconnectingAdapterFixture.Rows);
    assert.equal(fixture.ReopenCount, 1);
    assert.equal(inner1.DisposeCount, 1);
});

test("an auth failure reopens (re-resolves) then retries", async () =>
{
    const inner1 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Auth }]);
    const inner2 = new ScriptedAdapter([{ Return: ReconnectingAdapterFixture.Rows }]);
    const fixture = new ReconnectingAdapterFixture([inner2]);
    const rows = await fixture.Build(inner1).Query(ReconnectingAdapterFixture.Request);
    assert.equal(rows, ReconnectingAdapterFixture.Rows);
    assert.equal(fixture.ReopenCount, 1);
    assert.equal(inner1.DisposeCount, 1);
});

test("a permanent error rethrows immediately with no retry or reopen", async () =>
{
    const inner1 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Permanent, Message: "bad sql" }]);
    const fixture = new ReconnectingAdapterFixture([]);
    await assert.rejects(() => fixture.Build(inner1).Query(ReconnectingAdapterFixture.Request), /bad sql/);
    assert.equal(fixture.ReopenCount, 0);
    assert.equal(inner1.DisposeCount, 0);
});

test("attempts exhausted rethrows the last error", async () =>
{
    const inner1 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Transient }, { Throw: ConnectionFailureKind.Transient }]);
    const inner2 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Transient, Message: "last one" }, { Return: ReconnectingAdapterFixture.Rows }]);
    const fixture = new ReconnectingAdapterFixture([inner2]);
    await assert.rejects(() => fixture.Build(inner1).Query(ReconnectingAdapterFixture.Request), /last one/);
    assert.equal(fixture.ReopenCount, 1);
    assert.equal(inner2.DisposeCount, 0);
});

test("a completed Apply with Failures is returned unaltered and not retried", async () =>
{
    const inner1 = new ScriptedAdapter([{ Return: ReconnectingAdapterFixture.Conflict() }]);
    const fixture = new ReconnectingAdapterFixture([]);
    const actual = await fixture.Build(inner1).Apply(ReconnectingAdapterFixture.Batch);
    assert.deepEqual(actual, ReconnectingAdapterFixture.Conflict());
    assert.equal(fixture.ReopenCount, 0);
});

test("Apply retries a thrown transient and returns the reopened result unaltered", async () =>
{
    const result = ReconnectingAdapterFixture.Conflict();
    const inner1 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Transient }, { Throw: ConnectionFailureKind.Transient }]);
    const inner2 = new ScriptedAdapter([{ Return: result }]);
    const fixture = new ReconnectingAdapterFixture([inner2]);
    const actual = await fixture.Build(inner1).Apply(ReconnectingAdapterFixture.Batch);
    assert.equal(actual, result);
    assert.equal(fixture.ReopenCount, 1);
});

test("CanTransact/CanVersion reflect the current inner after a reopen", async () =>
{
    const inner1 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Transient }, { Throw: ConnectionFailureKind.Transient }]);
    inner1.CanTransact = false;
    inner1.CanVersion = false;
    const inner2 = new ScriptedAdapter([{ Return: ReconnectingAdapterFixture.Rows }]);
    inner2.CanTransact = true;
    inner2.CanVersion = true;
    const fixture = new ReconnectingAdapterFixture([inner2]);
    const adapter = fixture.Build(inner1);
    assert.equal(adapter.CanTransact, false);
    await adapter.Query(ReconnectingAdapterFixture.Request);
    assert.equal(adapter.CanTransact, true);
    assert.equal(adapter.CanVersion, true);
});

test("concurrent calls during a reopen trigger exactly one reopen", async () =>
{
    const inner1 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Transient }], true);
    const inner2 = new ScriptedAdapter([{ Return: ReconnectingAdapterFixture.Rows }], true);
    const fixture = new ReconnectingAdapterFixture([inner2]);
    const adapter = fixture.Build(inner1);
    const results = await Promise.all([
        adapter.Query(ReconnectingAdapterFixture.Request),
        adapter.Query(ReconnectingAdapterFixture.Request),
    ]);
    assert.equal(results[0], ReconnectingAdapterFixture.Rows);
    assert.equal(results[1], ReconnectingAdapterFixture.Rows);
    assert.equal(fixture.ReopenCount, 1);
});

test("a reconnect event carries the connector, kind, attempt and message but no secret", async () =>
{
    const events: ReconnectEvent[] = [];
    const observer: IReconnectObserver = { OnReconnect: (event) => { events.push(event); } };
    const inner = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Transient, Message: "connection reset" }, { Return: ReconnectingAdapterFixture.Rows }]);
    const fixture = new ReconnectingAdapterFixture([]);
    await fixture.Build(inner, observer).Query(ReconnectingAdapterFixture.Request);
    assert.equal(events.length, 1);
    const event = events[0]!;
    assert.equal(event.Connector, ReconnectingAdapterFixture.ConnectorName);
    assert.equal(event.Kind, ConnectionFailureKind.Transient);
    assert.ok(event.Attempt >= 1);
    assert.equal(event.Message, "connection reset");
    assert.ok(!JSON.stringify(events).includes(ReconnectingAdapterFixture.Secret));
});
