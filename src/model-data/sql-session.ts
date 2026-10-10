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
}
