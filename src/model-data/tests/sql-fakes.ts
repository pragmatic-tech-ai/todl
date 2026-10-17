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
