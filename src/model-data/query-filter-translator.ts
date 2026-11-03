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
            all.push({ Field: external, Op: term.Op, Value: term.Value });
        }
        return all.length === 0 ? undefined : { All: all };
    }
}
