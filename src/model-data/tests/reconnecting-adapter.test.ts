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

type ScriptedAction =
    | { Throw: ConnectionFailureKind; Message?: string; Detail?: string; Defer?: Promise<void> }
    | { ThrowRaw: unknown }
    | { Return: unknown };

class ScriptedAdapter implements IDataSourceAdapter
{
    private static readonly DefaultMessage = "scripted failure";
    private static readonly ExhaustedMessage = "script exhausted";
    private static readonly DetailKey = "Detail";

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
        return error instanceof TaggedError ? error.Kind : ConnectionFailureKind.Transient;
    }

    private async Next(): Promise<unknown>
    {
        const action = this.repeatLast && this.actions.length === 1 ? this.actions[0] : this.actions.shift();
        if (!action)
        {
            throw new Error(ScriptedAdapter.ExhaustedMessage);
        }
        if ("ThrowRaw" in action)
        {
            throw action.ThrowRaw;
        }
        if ("Throw" in action)
        {
            if (action.Defer)
            {
                await action.Defer;
            }
            const error = new TaggedError(action.Message ?? ScriptedAdapter.DefaultMessage, action.Throw);
            if (action.Detail)
            {
                (error as unknown as Record<string, unknown>)[ScriptedAdapter.DetailKey] = action.Detail;
            }
            throw error;
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
    public static readonly BadSql = "bad sql";
    public static readonly LastOne = "last one";
    public static readonly ConnectionReset = "connection reset";
    public static readonly AuthRejected = "auth rejected";
    public static readonly SecondTransient = "second transient";
    public static readonly UnknownMessage = "unknown connection error";
    public static readonly PlainString = "a plain string";
    public static readonly CredentialMessage = "connect ECONNREFUSED postgres://admin:s3cr3t@db.internal:5432";
    public static readonly CredentialPassword = "s3cr3t";
    public static readonly CredentialUserInfo = "admin:s3cr3t";
    public static readonly ConflictKey = "a";
    public static readonly ConflictReason = "stale";

    public ReopenCount = 0;
    public ReopenGate: Promise<void> | undefined;
    public readonly Reopened: ScriptedAdapter[];

    public constructor(reopened: ScriptedAdapter[])
    {
        this.Reopened = reopened;
    }

    public Reopen = async (): Promise<IDataSourceAdapter> =>
    {
        this.ReopenCount++;
        if (this.ReopenGate)
        {
            await this.ReopenGate;
        }
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
        return {
            Applied: 0,
            Failures: [{ Key: ReconnectingAdapterFixture.ConflictKey, Kind: WriteFailureKind.Conflict, Reason: ReconnectingAdapterFixture.ConflictReason }],
        };
    }

    public static Pattern(text: string): RegExp
    {
        return new RegExp(text);
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
    assert.equal(inner2.DisposeCount, 0);
});

test("a permanent error rethrows immediately with no retry or reopen", async () =>
{
    const inner1 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Permanent, Message: ReconnectingAdapterFixture.BadSql }]);
    const fixture = new ReconnectingAdapterFixture([]);
    await assert.rejects(() => fixture.Build(inner1).Query(ReconnectingAdapterFixture.Request), ReconnectingAdapterFixture.Pattern(ReconnectingAdapterFixture.BadSql));
    assert.equal(fixture.ReopenCount, 0);
    assert.equal(inner1.DisposeCount, 0);
});

test("attempts exhausted rethrows the last error", async () =>
{
    const inner1 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Transient }, { Throw: ConnectionFailureKind.Transient }]);
    const inner2 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Transient, Message: ReconnectingAdapterFixture.LastOne }, { Return: ReconnectingAdapterFixture.Rows }]);
    const fixture = new ReconnectingAdapterFixture([inner2]);
    await assert.rejects(() => fixture.Build(inner1).Query(ReconnectingAdapterFixture.Request), ReconnectingAdapterFixture.Pattern(ReconnectingAdapterFixture.LastOne));
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
    assert.equal(inner2.DisposeCount, 0);
});

test("a reconnect event carries the connector, kind, attempt and message but no secret", async () =>
{
    const events: ReconnectEvent[] = [];
    const observer: IReconnectObserver = { OnReconnect: (event) => { events.push(event); } };
    const inner = new ScriptedAdapter([
        { Throw: ConnectionFailureKind.Transient, Message: ReconnectingAdapterFixture.ConnectionReset, Detail: ReconnectingAdapterFixture.Secret },
        { Return: ReconnectingAdapterFixture.Rows },
    ]);
    const fixture = new ReconnectingAdapterFixture([]);
    await fixture.Build(inner, observer).Query(ReconnectingAdapterFixture.Request);
    assert.equal(events.length, 1);
    const event = events[0]!;
    assert.equal(event.Connector, ReconnectingAdapterFixture.ConnectorName);
    assert.equal(event.Kind, ConnectionFailureKind.Transient);
    assert.ok(event.Attempt >= 1);
    assert.equal(event.Message, ReconnectingAdapterFixture.ConnectionReset);
    assert.ok(!JSON.stringify(events).includes(ReconnectingAdapterFixture.Secret));
});

test("a caller whose op was in flight on a stale inner retries on the fresh one without a second reopen", async () =>
{
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inner1 = new ScriptedAdapter([
        { Throw: ConnectionFailureKind.Transient },
        { Throw: ConnectionFailureKind.Auth, Defer: gate },
        { Throw: ConnectionFailureKind.Transient },
    ]);
    const inner2 = new ScriptedAdapter([{ Return: ReconnectingAdapterFixture.Rows }], true);
    const fixture = new ReconnectingAdapterFixture([inner2]);
    const adapter = fixture.Build(inner1);
    const first = adapter.Query(ReconnectingAdapterFixture.Request);
    const second = adapter.Query(ReconnectingAdapterFixture.Request);
    assert.equal(await first, ReconnectingAdapterFixture.Rows);
    release();
    assert.equal(await second, ReconnectingAdapterFixture.Rows);
    assert.equal(fixture.ReopenCount, 1);
    assert.equal(inner1.DisposeCount, 1);
    assert.equal(inner2.DisposeCount, 0);
});

test("a failing reopen surfaces the original transient error", async () =>
{
    const inner1 = new ScriptedAdapter([
        { Throw: ConnectionFailureKind.Transient },
        { Throw: ConnectionFailureKind.Transient, Message: ReconnectingAdapterFixture.SecondTransient },
    ]);
    const fixture = new ReconnectingAdapterFixture([]);
    await assert.rejects(() => fixture.Build(inner1).Query(ReconnectingAdapterFixture.Request), ReconnectingAdapterFixture.Pattern(ReconnectingAdapterFixture.SecondTransient));
    assert.equal(fixture.ReopenCount, 1);
});

test("a failing reopen surfaces the original auth error", async () =>
{
    const inner1 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Auth, Message: ReconnectingAdapterFixture.AuthRejected }]);
    const fixture = new ReconnectingAdapterFixture([]);
    await assert.rejects(() => fixture.Build(inner1).Query(ReconnectingAdapterFixture.Request), ReconnectingAdapterFixture.Pattern(ReconnectingAdapterFixture.AuthRejected));
});

test("Dispose during an in-flight reopen disposes the newly installed inner", async () =>
{
    let release!: () => void;
    const inner1 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Transient }, { Throw: ConnectionFailureKind.Transient }]);
    const inner2 = new ScriptedAdapter([{ Return: ReconnectingAdapterFixture.Rows }]);
    const fixture = new ReconnectingAdapterFixture([inner2]);
    fixture.ReopenGate = new Promise<void>((resolve) => { release = resolve; });
    const adapter = fixture.Build(inner1);
    const query = adapter.Query(ReconnectingAdapterFixture.Request);
    while (fixture.ReopenCount === 0)
    {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const dispose = adapter.Dispose();
    release();
    await Promise.all([query, dispose]);
    assert.equal(inner1.DisposeCount, 1);
    assert.equal(inner2.DisposeCount, 1);
});

test("repeated auth failures are bounded by MaxAttempts", async () =>
{
    const inner1 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Auth }]);
    const inner2 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Auth }]);
    const inner3 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Auth, Message: ReconnectingAdapterFixture.AuthRejected }]);
    const fixture = new ReconnectingAdapterFixture([inner2, inner3]);
    await assert.rejects(() => fixture.Build(inner1).Query(ReconnectingAdapterFixture.Request), ReconnectingAdapterFixture.Pattern(ReconnectingAdapterFixture.AuthRejected));
    assert.equal(fixture.ReopenCount, ReconnectingAdapterFixture.Policy.MaxAttempts - 1);
});

test("a thrown non-Error value emits the generic unknown message, never the value", async () =>
{
    const events: ReconnectEvent[] = [];
    const observer: IReconnectObserver = { OnReconnect: (event) => { events.push(event); } };
    const inner = new ScriptedAdapter([{ ThrowRaw: ReconnectingAdapterFixture.PlainString }, { Return: ReconnectingAdapterFixture.Rows }]);
    const fixture = new ReconnectingAdapterFixture([]);
    await fixture.Build(inner, observer).Query(ReconnectingAdapterFixture.Request);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.Message, ReconnectingAdapterFixture.UnknownMessage);
    assert.ok(!JSON.stringify(events).includes(ReconnectingAdapterFixture.PlainString));
});

test("a reconnect event message has URL userinfo redacted", async () =>
{
    const events: ReconnectEvent[] = [];
    const observer: IReconnectObserver = { OnReconnect: (event) => { events.push(event); } };
    const inner = new ScriptedAdapter([
        { Throw: ConnectionFailureKind.Transient, Message: ReconnectingAdapterFixture.CredentialMessage },
        { Return: ReconnectingAdapterFixture.Rows },
    ]);
    const fixture = new ReconnectingAdapterFixture([]);
    await fixture.Build(inner, observer).Query(ReconnectingAdapterFixture.Request);
    assert.equal(events.length, 1);
    const message = events[0]!.Message;
    assert.ok(message.length > 0);
    assert.ok(!message.includes(ReconnectingAdapterFixture.CredentialPassword));
    assert.ok(!message.includes(ReconnectingAdapterFixture.CredentialUserInfo));
});

test("exhausting MaxAttempts emits a final event for the last attempt before rethrowing", async () =>
{
    const events: ReconnectEvent[] = [];
    const observer: IReconnectObserver = { OnReconnect: (event) => { events.push(event); } };
    const inner1 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Transient }, { Throw: ConnectionFailureKind.Transient }]);
    const inner2 = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Transient, Message: ReconnectingAdapterFixture.LastOne }]);
    const fixture = new ReconnectingAdapterFixture([inner2]);
    await assert.rejects(() => fixture.Build(inner1, observer).Query(ReconnectingAdapterFixture.Request), ReconnectingAdapterFixture.Pattern(ReconnectingAdapterFixture.LastOne));
    const max = ReconnectingAdapterFixture.Policy.MaxAttempts;
    assert.equal(events.length, max);
    assert.equal(events[events.length - 1]!.Attempt, max);
    assert.equal(events[events.length - 1]!.Message, ReconnectingAdapterFixture.LastOne);
});

test("an immediate permanent failure emits no events", async () =>
{
    const events: ReconnectEvent[] = [];
    const observer: IReconnectObserver = { OnReconnect: (event) => { events.push(event); } };
    const inner = new ScriptedAdapter([{ Throw: ConnectionFailureKind.Permanent, Message: ReconnectingAdapterFixture.BadSql }]);
    const fixture = new ReconnectingAdapterFixture([]);
    await assert.rejects(() => fixture.Build(inner, observer).Query(ReconnectingAdapterFixture.Request), ReconnectingAdapterFixture.Pattern(ReconnectingAdapterFixture.BadSql));
    assert.equal(events.length, 0);
});
