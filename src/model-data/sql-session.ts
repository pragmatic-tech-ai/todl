import type { ConnectionFailureKind } from "./connection-reconnect.js";

/** One row returned by a SQL query, keyed by column name. */
export interface SqlRow
{
    readonly [column: string]: unknown;
}

/**
 * The injected SQL driver seam (mirrors CypherSession): the adapter owns SQL
 * text, the host supplies the connection. Params are positional.
 */
export interface ISqlSession
{
    Query(sql: string, params: readonly unknown[]): Promise<readonly SqlRow[]>;
    /** Runs a statement and returns the affected-row count. */
    Execute(sql: string, params: readonly unknown[]): Promise<number>;
    /**
     * Optional: runs `work` inside one backend transaction, committing on resolve and rolling back +
     * rethrowing on reject. Absent on sessions that cannot transact (REST/GraphQL, non-replica Mongo).
     */
    Transaction?<T>(work: (tx: ISqlSession) => Promise<T>): Promise<T>;
    /** Optional: closes a pool-backed connection. In-memory/recording sessions omit it. */
    Dispose?(): Promise<void>;
    /** Classifies a thrown driver error so the reconnecting catalog can retry/reopen. Optional so existing
     *  fakes and the adapter-pack ABI keep compiling; absent -> every error is treated as Permanent. */
    ClassifyFailure?(error: unknown): ConnectionFailureKind;
}
