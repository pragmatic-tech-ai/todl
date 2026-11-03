import { QueryCompareOp, type ExternalFieldValue, type QueryComparison, type QueryFilter } from "./connector-plan.js";

/**
 * The reference in-memory semantics of a push-down filter, shared by every adapter that re-filters pulled rows (REST,
 * GraphQL, document, the test fakes). An adapter that pushes a filter to its source and does not re-filter (SQL, a paged
 * Cypher read) follows the source's own semantics instead (collation, type coercion). Shared rules: a NULL (or missing) field satisfies only IS NULL;
 * every other comparison against NULL is unknown, so the row is excluded. Ordering compares like with like only
 * (number with number, string with string by code unit, boolean false < true); mixed types never match.
 */
export class QueryFilterEvaluator
{
    public static Matches(record: { readonly [field: string]: unknown }, filter: QueryFilter | undefined): boolean
    {
        return (filter?.All ?? []).every((term) => QueryFilterEvaluator.Term(QueryFilterEvaluator.Coerce(record[term.Field]), term));
    }

    public static Term(value: ExternalFieldValue, term: QueryComparison): boolean
    {
        switch (term.Op)
        {
            case QueryCompareOp.IsNull: return value === null;
            case QueryCompareOp.IsNotNull: return value !== null;
            case QueryCompareOp.In: return value !== null && (term.Values ?? []).some((v) => v !== null && v === value);
            default: break;
        }
        if (value === null || term.Value === null) return false;
        switch (term.Op)
        {
            case QueryCompareOp.Eq: return value === term.Value;
            case QueryCompareOp.Neq: return value !== term.Value;
            default: break;
        }
        if (typeof value !== typeof term.Value) return false;
        const order = value < term.Value ? -1 : value > term.Value ? 1 : 0;
        switch (term.Op)
        {
            case QueryCompareOp.Lt: return order < 0;
            case QueryCompareOp.Lte: return order <= 0;
            case QueryCompareOp.Gt: return order > 0;
            case QueryCompareOp.Gte: return order >= 0;
            default: return false;
        }
    }

    /** string/number/boolean/null pass through; undefined -> null; anything else -> String(value). */
    public static Coerce(value: unknown): ExternalFieldValue
    {
        if (value === undefined || value === null) return null;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
        return String(value);
    }
}
