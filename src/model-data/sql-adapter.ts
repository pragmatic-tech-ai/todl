import { WriteOperationKind } from "./connector-plan.js";
import type { ExternalFieldValue, ExternalRecord, QueryRequest, WriteBatch, WriteConflict, WriteOperation, WriteResult } from "./connector-plan.js";
import type { IDataSourceAdapter } from "./data-source-adapter.js";
import type { ISqlSession, SqlRow } from "./sql-session.js";

/** Translates read requests into SQL SELECT statements run through an {@link ISqlSession}. */
export class SqlQueryTranslator
{
    private static readonly SelectKeyword = "SELECT ";
    private static readonly FromKeyword = " FROM ";
    private static readonly ListSeparator = ", ";
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
        const sql = SqlQueryTranslator.SelectKeyword
            + request.Fields.map((f) => SqlQueryTranslator.QuoteIdent(f)).join(SqlQueryTranslator.ListSeparator)
            + SqlQueryTranslator.FromKeyword
            + SqlQueryTranslator.QuoteIdent(request.Source);
        const rows = await this.session.Query(sql, []);
        return rows.map(row => SqlQueryTranslator.ToRecord(row));
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
    private static readonly Excluded = "EXCLUDED.";
    private static readonly DeleteFrom = "DELETE FROM ";
    private static readonly Where = " WHERE ";
    private static readonly Equals = " = ";
    private static readonly ListSeparator = ", ";
    private static readonly Placeholder = "$";
    private static readonly QualifierDot = ".";
    private static readonly VersionConflictReason = "version mismatch";

    private readonly translator: SqlQueryTranslator;

    public constructor(private readonly session: ISqlSession)
    {
        this.translator = new SqlQueryTranslator(session);
    }

    public Query(request: QueryRequest): Promise<readonly ExternalRecord[]>
    {
        return this.translator.Query(request);
    }

    public async Apply(batch: WriteBatch): Promise<WriteResult>
    {
        let applied = 0;
        const conflicts: WriteConflict[] = [];
        for (const op of batch.Operations)
        {
            if (op.Kind === WriteOperationKind.Delete)
            {
                // Delete is unconditional in v1: no version guard.
                await this.session.Execute(this.DeleteSql(batch), [op.Key]);
                applied++;
            }
            else if (await this.ApplyUpsert(batch, op))
            {
                applied++;
            }
            else
            {
                conflicts.push({ Key: op.Key, Reason: SqlAdapter.VersionConflictReason });
            }
        }
        return { Applied: applied, Conflicts: conflicts };
    }

    /** Runs one upsert; returns false when a version-guarded upsert updated no row. */
    private async ApplyUpsert(batch: WriteBatch, op: WriteOperation): Promise<boolean>
    {
        const fieldNames = Object.keys(op.Fields).filter(name => name !== batch.IdKey);
        const columns = [batch.IdKey, ...fieldNames];
        const params: unknown[] = [op.Key, ...fieldNames.map(name => op.Fields[name])];
        const quote = (name: string): string => SqlQueryTranslator.QuoteIdent(name);

        let sql = SqlAdapter.InsertInto + quote(batch.Source)
            + " (" + columns.map(quote).join(SqlAdapter.ListSeparator) + ")"
            + SqlAdapter.Values
            + "(" + columns.map((_, i) => SqlAdapter.Placeholder + (i + 1)).join(SqlAdapter.ListSeparator) + ")"
            + SqlAdapter.OnConflict + "(" + quote(batch.IdKey) + ")"
            + SqlAdapter.DoUpdateSet
            + fieldNames
                .map(name => quote(name) + SqlAdapter.Equals + SqlAdapter.Excluded + quote(name))
                .join(SqlAdapter.ListSeparator);

        if (batch.VersionField === undefined)
        {
            await this.session.Execute(sql, params);
            return true;
        }

        params.push(op.Version ?? null);
        sql += SqlAdapter.Where + quote(batch.Source) + SqlAdapter.QualifierDot + quote(batch.VersionField)
            + SqlAdapter.Equals + SqlAdapter.Placeholder + params.length;
        return (await this.session.Execute(sql, params)) > 0;
    }

    private DeleteSql(batch: WriteBatch): string
    {
        return SqlAdapter.DeleteFrom + SqlQueryTranslator.QuoteIdent(batch.Source)
            + SqlAdapter.Where + SqlQueryTranslator.QuoteIdent(batch.IdKey)
            + SqlAdapter.Equals + SqlAdapter.Placeholder + "1";
    }
}
