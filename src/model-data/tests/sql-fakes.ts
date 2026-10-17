import type { ISqlSession, SqlRow } from "../sql-session.js";

/** Records every call; Query returns canned rows (default none), Execute returns a configurable count (default 1). */
export class RecordingSqlSession implements ISqlSession
{
    public readonly calls: { sql: string; params: readonly unknown[] }[] = [];

    public constructor(
        private readonly rows: readonly SqlRow[] = [],
        private readonly affected: number = 1)
    {
    }

    public async Query(sql: string, params: readonly unknown[]): Promise<readonly SqlRow[]>
    {
        this.calls.push({ sql, params });
        return this.rows;
    }

    public async Execute(sql: string, params: readonly unknown[]): Promise<number>
    {
        this.calls.push({ sql, params });
        return this.affected;
    }
}

/** Records every call; throws the configured error on the nth Execute (1-based), otherwise affects 1 row. */
export class FailingSqlSession implements ISqlSession
{
    public readonly calls: { sql: string; params: readonly unknown[] }[] = [];
    private executeCount = 0;

    public constructor(
        private readonly failOnExecute: number,
        private readonly error: Error)
    {
    }

    public async Query(sql: string, params: readonly unknown[]): Promise<readonly SqlRow[]>
    {
        this.calls.push({ sql, params });
        return [];
    }

    public async Execute(sql: string, params: readonly unknown[]): Promise<number>
    {
        this.calls.push({ sql, params });
        this.executeCount++;
        if (this.executeCount === this.failOnExecute)
        {
            throw this.error;
        }
        return 1;
    }
}

/** Rejects every Execute with the configured non-Error value (exercises the String(error) branch). */
export class RejectingSqlSession implements ISqlSession
{
    public readonly calls: { sql: string; params: readonly unknown[] }[] = [];

    public constructor(private readonly thrown: unknown)
    {
    }

    public async Query(sql: string, params: readonly unknown[]): Promise<readonly SqlRow[]>
    {
        this.calls.push({ sql, params });
        return [];
    }

    public async Execute(sql: string, params: readonly unknown[]): Promise<number>
    {
        this.calls.push({ sql, params });
        throw this.thrown;
    }
}

/**
 * An in-memory SQL session with a real transaction boundary. Execute records a persisted key per
 * statement (DELETE removes it), and Transaction snapshots the store so a rejected unit of work
 * discards every mutation it made (observable via {@link PersistedKeys}). Optionally throws, or
 * reports a zero rowcount (a version-guard miss), on the nth Execute to drive the rollback paths.
 */
export class TransactionalSqlSession implements ISqlSession
{
    private static readonly DeletePrefix = "DELETE FROM ";
    private static readonly DefaultErrorMessage = "simulated driver error";

    public readonly calls: { sql: string; params: readonly unknown[] }[] = [];
    private readonly persisted = new Map<string, true>();
    private executeCount = 0;

    public constructor(
        private readonly errorOnExecute: number = 0,
        private readonly error?: Error,
        private readonly conflictOnExecute: number = 0)
    {
    }

    /** The keys currently persisted: populated after a committed transaction, empty after a rollback. */
    public get PersistedKeys(): readonly string[]
    {
        return [...this.persisted.keys()];
    }

    public async Query(sql: string, params: readonly unknown[]): Promise<readonly SqlRow[]>
    {
        this.calls.push({ sql, params });
        return [];
    }

    public async Execute(sql: string, params: readonly unknown[]): Promise<number>
    {
        this.calls.push({ sql, params });
        this.executeCount++;
        if (this.executeCount === this.errorOnExecute)
        {
            throw this.error ?? new Error(TransactionalSqlSession.DefaultErrorMessage);
        }
        if (this.executeCount === this.conflictOnExecute)
        {
            // Version guard matched no row: report a zero rowcount and persist nothing.
            return 0;
        }
        const key = String(params[0]);
        if (sql.startsWith(TransactionalSqlSession.DeletePrefix))
        {
            this.persisted.delete(key);
        }
        else
        {
            this.persisted.set(key, true);
        }
        return 1;
    }

    public async Transaction<T>(work: (tx: ISqlSession) => Promise<T>): Promise<T>
    {
        const snapshot = new Map(this.persisted);
        try
        {
            return await work(this);
        }
        catch (error)
        {
            this.persisted.clear();
            for (const [key, value] of snapshot)
            {
                this.persisted.set(key, value);
            }
            throw error;
        }
    }
}

/** Returns canned rows from Query; Execute affects 0 rows. */
export class DataSqlSession implements ISqlSession
{
    public constructor(private readonly rows: readonly SqlRow[])
    {
    }

    public async Query(_sql: string, _params: readonly unknown[]): Promise<readonly SqlRow[]>
    {
        return this.rows;
    }

    public async Execute(_sql: string, _params: readonly unknown[]): Promise<number>
    {
        return 0;
    }
}
