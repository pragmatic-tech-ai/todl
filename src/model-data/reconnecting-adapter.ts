import type { QueryRequest, ExternalRecord, WriteBatch, WriteResult } from "./connector-plan.js";
import type { IDataSourceAdapter } from "./data-source-adapter.js";
import { ConnectionFailureKind, ConnectionRetryBackoff } from "./connection-reconnect.js";
import type { ConnectionRetryPolicy, IReconnectObserver } from "./connection-reconnect.js";

/** Wraps a data-source adapter so transient failures retry with backoff and dead/auth failures
 *  evict-and-reopen (re-resolving credentials via the reopen closure). Driver-agnostic: it asks the
 *  inner adapter to classify each thrown error (absent classifier -> Permanent, i.e. no retry). */
export class ReconnectingAdapter implements IDataSourceAdapter
{
    private static readonly UnknownMessage = "unknown connection error";

    private inner: IDataSourceAdapter;
    private reopening: Promise<void> | undefined;
    private readonly backoff: ConnectionRetryBackoff;

    public constructor(
        private readonly connector: string,
        inner: IDataSourceAdapter,
        private readonly reopen: () => Promise<IDataSourceAdapter>,
        private readonly policy: ConnectionRetryPolicy,
        private readonly observer?: IReconnectObserver,
        random: () => number = Math.random,
        private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    )
    {
        this.inner = inner;
        this.backoff = new ConnectionRetryBackoff(policy, random);
    }

    public get CanTransact(): boolean
    {
        return this.inner.CanTransact ?? false;
    }

    public get CanVersion(): boolean
    {
        return this.inner.CanVersion ?? false;
    }

    public Query(request: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        return this.Run((adapter) => adapter.Query(request));
    }

    public Apply(batch: WriteBatch): Promise<WriteResult>
    {
        return this.Run((adapter) => adapter.Apply(batch));
    }

    public async Dispose(): Promise<void>
    {
        if (this.reopening)
        {
            try
            {
                await this.reopening;
            }
            catch
            {
                // A failed reopen leaves the current inner in place; dispose it below.
            }
        }
        await this.inner.Dispose();
    }

    private async Run<T>(op: (adapter: IDataSourceAdapter) => Promise<T>): Promise<T>
    {
        let consecutiveTransient = 0;
        for (let attempt = 1; ; attempt++)
        {
            const current = this.inner;
            try
            {
                return await op(current);
            }
            catch (error)
            {
                const kind = this.Classify(current, error);
                if (kind === ConnectionFailureKind.Permanent || attempt >= this.policy.MaxAttempts)
                {
                    throw error;
                }
                this.Emit(kind, attempt, error);
                if (this.inner !== current)
                {
                    // Another caller already reopened to a fresh inner; just retry on it.
                    consecutiveTransient = 0;
                }
                else if (kind === ConnectionFailureKind.Auth)
                {
                    await this.ReopenOrRethrow(error);
                    consecutiveTransient = 0;
                }
                else
                {
                    consecutiveTransient++;
                    if (consecutiveTransient >= 2)
                    {
                        await this.ReopenOrRethrow(error);
                    }
                }
                await this.sleep(this.backoff.Next(attempt));
            }
        }
    }

    private async ReopenOrRethrow(error: unknown): Promise<void>
    {
        try
        {
            await this.Reopen();
        }
        catch
        {
            // A failing reopen must not mask the operation failure that triggered it.
            throw error;
        }
    }

    private Classify(current: IDataSourceAdapter, error: unknown): ConnectionFailureKind
    {
        const classify = current.ClassifyFailure?.bind(current);
        return classify ? classify(error) : ConnectionFailureKind.Permanent;
    }

    private async Reopen(): Promise<void>
    {
        if (!this.reopening)
        {
            const previous = this.inner;
            const pending = (async () =>
            {
                const next = await this.reopen();
                this.inner = next;
                try
                {
                    await previous.Dispose();
                }
                catch
                {
                    // A dead connection's Dispose may throw; the replacement is already in place.
                }
            })();
            this.reopening = pending;
            pending.then(
                () => { this.reopening = undefined; },
                () => { this.reopening = undefined; },
            );
        }
        await this.reopening;
    }

    private Emit(kind: ConnectionFailureKind, attempt: number, error: unknown): void
    {
        if (!this.observer)
        {
            return;
        }
        const message = error instanceof Error ? error.message : ReconnectingAdapter.UnknownMessage;
        this.observer.OnReconnect({ Connector: this.connector, Kind: kind, Attempt: attempt, Message: message });
    }
}
