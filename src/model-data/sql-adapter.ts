import { QueryCompareOp, WriteAtomicity, WriteConcurrency, WriteFailureKind, WriteOperationKind } from "./connector-plan.js";
import type { ExternalFieldValue, ExternalRecord, QueryRequest, WriteBatch, WriteFailure, WriteOperation, WriteResult } from "./connector-plan.js";
import { ConnectionFailureKind } from "./connection-reconnect.js";
import type { IDataSourceAdapter, PageQuery, PageSlice } from "./data-source-adapter.js";
import { RollbackSignal } from "./rollback-signal.js";
import type { ISqlSession, SqlRow } from "./sql-session.js";
import { WriteCapability } from "./write-capability.js";

/** Translates read requests into SQL SELECT statements run through an {@link ISqlSession}. */
export class SqlQueryTranslator
{
    private static readonly SelectKeyword = "SELECT ";
    private static readonly FromKeyword = " FROM ";
    private static readonly ListSeparator = ", ";
    private static readonly WhereKeyword = " WHERE ";
    private static readonly AndKeyword = " AND ";
    private static readonly OrderByKeyword = " ORDER BY ";
    private static readonly LimitKeyword = " LIMIT ";
    private static readonly GreaterOperator = " > ";
    private static readonly EqualsOperator = " = ";
    private static readonly NotEqualsOperator = " <> ";
    private static readonly PlaceholderPrefix = "$";
    private static readonly IdentQuote = "\"";
    private static readonly EscapedIdentQuote = "\"\"";

    public constructor(private readonly session: ISqlSession)
    {
    }

    /** Double-quotes an identifier, doubling any embedded double quote. */
    public static QuoteIdent(name: string): string
    {
        return SqlQueryTranslator.IdentQuote
            + name.replaceAll(SqlQueryTranslator.IdentQuote, SqlQueryTranslator.EscapedIdentQuote)
            + SqlQueryTranslator.IdentQuote;
    }

    public async Query(request: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        let sql = SqlQueryTranslator.SelectKeyword
            + request.Fields.map((f) => SqlQueryTranslator.QuoteIdent(f)).join(SqlQueryTranslator.ListSeparator)
            + SqlQueryTranslator.FromKeyword
            + SqlQueryTranslator.QuoteIdent(request.Source);
        const params: ExternalFieldValue[] = [];
        if (request.Where !== undefined && request.Where.All.length > 0)
        {
            const terms: string[] = [];
            for (const comparison of request.Where.All)
            {
                params.push(comparison.Value);
                terms.push(SqlQueryTranslator.QuoteIdent(comparison.Field)
                    + SqlQueryTranslator.OperatorSql(comparison.Op)
                    + SqlQueryTranslator.PlaceholderPrefix + params.length);
            }
            sql += SqlQueryTranslator.WhereKeyword + terms.join(SqlQueryTranslator.AndKeyword);
        }
        const rows = await this.session.Query(sql, params);
        return rows.map(row => SqlQueryTranslator.ToRecord(row));
    }

    /** Keyset page: seeks strictly after `page.After` on the order key, ANDed with Where (keyset term last). */
    public async QueryPage(request: QueryRequest, page: PageQuery): Promise<PageSlice>
    {
        const orderKey = request.OrderKey ?? request.Fields[0]!;
        let sql = SqlQueryTranslator.SelectKeyword
            + request.Fields.map((f) => SqlQueryTranslator.QuoteIdent(f)).join(SqlQueryTranslator.ListSeparator)
            + SqlQueryTranslator.FromKeyword
            + SqlQueryTranslator.QuoteIdent(request.Source);
        const params: ExternalFieldValue[] = [];
        const terms: string[] = [];
        for (const comparison of request.Where?.All ?? [])
        {
            params.push(comparison.Value);
            terms.push(SqlQueryTranslator.QuoteIdent(comparison.Field)
                + SqlQueryTranslator.OperatorSql(comparison.Op)
                + SqlQueryTranslator.PlaceholderPrefix + params.length);
        }
        if (page.After !== undefined)
        {
            params.push(page.After);
            terms.push(SqlQueryTranslator.QuoteIdent(orderKey)
                + SqlQueryTranslator.GreaterOperator
                + SqlQueryTranslator.PlaceholderPrefix + params.length);
        }
        if (terms.length > 0)
        {
            sql += SqlQueryTranslator.WhereKeyword + terms.join(SqlQueryTranslator.AndKeyword);
        }
        sql += SqlQueryTranslator.OrderByKeyword + SqlQueryTranslator.QuoteIdent(orderKey)
            + SqlQueryTranslator.LimitKeyword + page.Limit;
        const rows = await this.session.Query(sql, params);
        const records = rows.map(row => SqlQueryTranslator.ToRecord(row));
        return SqlQueryTranslator.SliceOf(records, orderKey, page.Limit);
    }

    private static SliceOf(records: readonly ExternalRecord[], orderKey: string, limit: number): PageSlice
    {
        const nextAfter = records.length === limit && limit > 0 ? records[records.length - 1]![orderKey] : undefined;
        return nextAfter === undefined ? { Records: records } : { Records: records, NextAfter: nextAfter };
    }

    private static OperatorSql(op: QueryCompareOp): string
    {
        return op === QueryCompareOp.Neq ? SqlQueryTranslator.NotEqualsOperator : SqlQueryTranslator.EqualsOperator;
    }

    private static ToRecord(row: SqlRow): ExternalRecord
    {
        const record: Record<string, ExternalFieldValue> = {};
        for (const column of Object.keys(row))
        {
            record[column] = SqlQueryTranslator.Coerce(row[column]);
        }
        return record;
    }

    /**
     * Coercion to ExternalFieldValue: string/number/boolean/null pass through,
     * undefined becomes null, and anything else (Date, bigint, Buffer, ...) is String(value).
     */
    private static Coerce(value: unknown): ExternalFieldValue
    {
        if (value === undefined || value === null) return null;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
        return String(value);
    }
}

/** SQL data-source adapter: reads via {@link SqlQueryTranslator}, writes as parameterized upsert/delete statements. */
export class SqlAdapter implements IDataSourceAdapter
{
    private static readonly InsertInto = "INSERT INTO ";
    private static readonly Values = " VALUES ";
    private static readonly OnConflict = " ON CONFLICT ";
    private static readonly DoUpdateSet = " DO UPDATE SET ";
    private static readonly DoNothing = " DO NOTHING";
    private static readonly Excluded = "EXCLUDED.";
    private static readonly DeleteFrom = "DELETE FROM ";
    private static readonly Where = " WHERE ";
    private static readonly Equals = " = ";
    private static readonly ListSeparator = ", ";
    private static readonly Placeholder = "$";
    private static readonly QualifierDot = ".";
    private static readonly OpenParen = "(";
    private static readonly SpacedOpenParen = " (";
    private static readonly CloseParen = ")";
    private static readonly FirstParamIndex = "1";
    private static readonly VersionConflictReason = "version mismatch";
    private static readonly AtomicUnsupportedReason = "atomic write not supported by this connector";

    private readonly translator: SqlQueryTranslator;

    public constructor(private readonly session: ISqlSession)
    {
        this.translator = new SqlQueryTranslator(session);
    }

    /** Whether this adapter can run a batch inside a backend transaction: true iff its session can. */
    public get CanTransact(): boolean
    {
        return this.session.Transaction !== undefined;
    }

    /** Classifies a connection/auth failure via the session; a session without a classifier is Permanent. */
    public ClassifyFailure(error: unknown): ConnectionFailureKind
    {
        return this.session.ClassifyFailure?.(error) ?? ConnectionFailureKind.Permanent;
    }

    /** Whether this adapter can enforce an optimistic version guard: true (it emits the versioned WHERE guard). */
    public get CanVersion(): boolean
    {
        return true;
    }

    public Query(request: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        return this.translator.Query(request);
    }

    /** Whether this adapter can serve keyset-paged reads: true. */
    public readonly CanPage = true;

    public QueryPage(request: QueryRequest, page: PageQuery): Promise<PageSlice>
    {
        return this.translator.QueryPage(request, page);
    }

    /** Dispatches on the batch's atomicity axis: resilient Sequential apply, or all-or-nothing Transactional. */
    public async Apply(batch: WriteBatch): Promise<WriteResult>
    {
        if (batch.Atomicity === WriteAtomicity.Transactional)
        {
            return this.ApplyTransactional(batch);
        }
        return this.ApplySequential(batch);
    }

    /**
     * Sequential resilient apply: runs ops in order; a thrown driver error becomes a
     * WriteFailure{Error} and the batch CONTINUES to the next op (no rollback; still-pending ops
     * remain in the working copy). Applied counts only ops that persisted.
     */
    private async ApplySequential(batch: WriteBatch): Promise<WriteResult>
    {
        let applied = 0;
        const failures: WriteFailure[] = [];
        for (const op of batch.Operations)
        {
            const failure = await this.ApplyOne(this.session, batch, op);
            if (failure === undefined)
            {
                applied++;
            }
            else
            {
                failures.push(failure);
            }
        }
        return { Applied: applied, Failures: failures };
    }

    /**
     * Transactional all-or-nothing apply. A backend that cannot transact returns every op as
     * Unsupported (never a silent downgrade to partial). Otherwise the whole op loop runs inside one
     * session transaction; any Conflict or Error throws a RollbackSignal to abort the backend
     * transaction, caught here so the collected failures come back with Applied 0.
     */
    private async ApplyTransactional(batch: WriteBatch): Promise<WriteResult>
    {
        if (!WriteCapability.CanTransact(this))
        {
            return {
                Applied: 0,
                Failures: batch.Operations.map(op => ({
                    Key: op.Key,
                    Kind: WriteFailureKind.Unsupported,
                    Reason: SqlAdapter.AtomicUnsupportedReason,
                })),
            };
        }
        try
        {
            return await this.session.Transaction!(async (tx) =>
            {
                let applied = 0;
                const failures: WriteFailure[] = [];
                for (const op of batch.Operations)
                {
                    const failure = await this.ApplyOne(tx, batch, op);
                    if (failure === undefined)
                    {
                        applied++;
                    }
                    else
                    {
                        failures.push(failure);
                    }
                }
                if (failures.length > 0)
                {
                    // Abort the backend transaction; the caller reports nothing as applied.
                    throw new RollbackSignal({ Applied: 0, Failures: failures });
                }
                return { Applied: applied, Failures: failures };
            });
        }
        catch (error)
        {
            if (error instanceof RollbackSignal)
            {
                return error.Result;
            }
            throw error;
        }
    }

    /** Releases the underlying session, if it supports disposal. */
    public async Dispose(): Promise<void>
    {
        await this.session.Dispose?.();
    }

    /**
     * Applies one op against a given session (so Sequential and Transactional share the logic):
     * returns undefined on success, or the WriteFailure (Conflict for a guarded no-op row, Error for
     * a thrown driver fault) otherwise.
     */
    private async ApplyOne(session: ISqlSession, batch: WriteBatch, op: WriteOperation): Promise<WriteFailure | undefined>
    {
        try
        {
            if (op.Kind === WriteOperationKind.Delete)
            {
                // Delete is unconditional in v1: no version guard.
                await session.Execute(SqlAdapter.DeleteSql(batch), [op.Key]);
                return undefined;
            }
            if (await this.ApplyUpsert(session, batch, op))
            {
                return undefined;
            }
            return { Key: op.Key, Kind: WriteFailureKind.Conflict, Reason: SqlAdapter.VersionConflictReason };
        }
        catch (error)
        {
            return { Key: op.Key, Kind: WriteFailureKind.Error, Reason: SqlAdapter.ErrorReason(error) };
        }
    }

    /** Runs one upsert against the given session; returns false when a version-guarded upsert updated no row. */
    private async ApplyUpsert(session: ISqlSession, batch: WriteBatch, op: WriteOperation): Promise<boolean>
    {
        const fieldNames = Object.keys(op.Fields).filter(name => name !== batch.IdKey);
        const columns = [batch.IdKey, ...fieldNames];
        const params: unknown[] = [op.Key, ...fieldNames.map(name => op.Fields[name])];

        let sql = SqlAdapter.InsertInto + SqlQueryTranslator.QuoteIdent(batch.Source)
            + SqlAdapter.SpacedOpenParen
            + columns.map(name => SqlQueryTranslator.QuoteIdent(name)).join(SqlAdapter.ListSeparator)
            + SqlAdapter.CloseParen
            + SqlAdapter.Values
            + SqlAdapter.OpenParen
            + columns.map((_, i) => SqlAdapter.Placeholder + (i + 1)).join(SqlAdapter.ListSeparator)
            + SqlAdapter.CloseParen
            + SqlAdapter.OnConflict
            + SqlAdapter.OpenParen + SqlQueryTranslator.QuoteIdent(batch.IdKey) + SqlAdapter.CloseParen;

        if (fieldNames.length === 0)
        {
            // Key-only: nothing to update, so no version guard; DO NOTHING affecting 0 rows is not a conflict.
            await session.Execute(sql + SqlAdapter.DoNothing, params);
            return true;
        }

        sql += SqlAdapter.DoUpdateSet
            + fieldNames
                .map(name => SqlQueryTranslator.QuoteIdent(name) + SqlAdapter.Equals
                    + SqlAdapter.Excluded + SqlQueryTranslator.QuoteIdent(name))
                .join(SqlAdapter.ListSeparator);

        if (batch.Concurrency === WriteConcurrency.Optimistic && batch.VersionField !== undefined)
        {
            // Optimistic: guard on the version column. A missing op.Version binds NULL and
            // "= NULL" never matches, so rowcount 0 -> Conflict (fail-closed: never a silent
            // overwrite of a present-but-unversioned record).
            params.push(op.Version ?? null);
            sql += SqlAdapter.Where + SqlQueryTranslator.QuoteIdent(batch.Source) + SqlAdapter.QualifierDot
                + SqlQueryTranslator.QuoteIdent(batch.VersionField)
                + SqlAdapter.Equals + SqlAdapter.Placeholder + params.length;
            return (await session.Execute(sql, params)) > 0;
        }

        // LastWriteWins: unconditional upsert, no version guard regardless of VersionField; always applies.
        await session.Execute(sql, params);
        return true;
    }

    private static ErrorReason(error: unknown): string
    {
        return error instanceof Error ? error.message : String(error);
    }

    private static DeleteSql(batch: WriteBatch): string
    {
        return SqlAdapter.DeleteFrom + SqlQueryTranslator.QuoteIdent(batch.Source)
            + SqlAdapter.Where + SqlQueryTranslator.QuoteIdent(batch.IdKey)
            + SqlAdapter.Equals + SqlAdapter.Placeholder + SqlAdapter.FirstParamIndex;
    }
}
