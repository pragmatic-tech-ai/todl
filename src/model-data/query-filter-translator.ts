import type { ConnectorBinding, QueryComparison, QueryFilter } from "./connector-plan.js";

/** Translates a provider's filter (model member names) into a binding's source query filter (external field names). */
export class QueryFilterTranslator
{
    /** Each term's member mapped through the binding's FieldMap. A term on an unmapped member, or on the id member (whose
     *  value is carried by storageId, not an attr), is dropped: dropping a conjunct only widens the pull. */
    public static External(binding: ConnectorBinding, filter: QueryFilter | undefined): QueryFilter | undefined
    {
        if (filter === undefined) return undefined;
        const all: QueryComparison[] = [];
        for (const term of filter.All)
        {
            const external = Object.hasOwn(binding.FieldMap, term.Field) ? binding.FieldMap[term.Field] : undefined;
            if (external === undefined || external === binding.IdKey) continue;
            all.push(QueryFilterTranslator.Renamed(term, external));
        }
        return all.length === 0 ? undefined : { All: all };
    }

    /** An AUTHORITATIVE filter (the caller's own query, not a widening push-down) in external names: every term must name a
     *  mapped member (the id member maps to the IdKey column); an unmapped member throws UnmappedFilterFieldError. */
    public static Strict(binding: ConnectorBinding, filter: QueryFilter): QueryFilter
    {
        return {
            All: filter.All.map((term) =>
            {
                const external = Object.hasOwn(binding.FieldMap, term.Field) ? binding.FieldMap[term.Field] : undefined;
                if (external === undefined) throw new UnmappedFilterFieldError(term.Field);
                return QueryFilterTranslator.Renamed(term, external);
            }),
        };
    }

    private static Renamed(term: QueryComparison, field: string): QueryComparison
    {
        return term.Values === undefined
            ? { Field: field, Op: term.Op, Value: term.Value }
            : { Field: field, Op: term.Op, Value: term.Value, Values: [...term.Values] };
    }
}

/** A filter term names a member the binding does not map to the source. */
export class UnmappedFilterFieldError extends Error
{
    private static readonly MessagePrefix = "filter field is not mapped to the source: ";
    private static readonly ErrorName = "UnmappedFilterFieldError";

    constructor(readonly Field: string)
    {
        super(UnmappedFilterFieldError.MessagePrefix + Field);
        this.name = UnmappedFilterFieldError.ErrorName;
    }
}
