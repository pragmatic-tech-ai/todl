import type { ExternalFieldValue, ExternalRecord, QueryRequest } from "./connector-plan.js";
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
            + request.Fields.map(SqlQueryTranslator.QuoteIdent).join(SqlQueryTranslator.ListSeparator)
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
