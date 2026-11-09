import type { QueryComparison, QueryFilter } from "./connector-plan.js";
import type { IConnectorQueryFilterProvider } from "./federated-model-data-connector.js";

/** ANDs several providers' filters (e.g. a security policy's and a query's), so a connector installs them as one. */
export class ConjunctiveQueryFilterProvider implements IConnectorQueryFilterProvider
{
    private readonly providers: readonly IConnectorQueryFilterProvider[];

    constructor(...providers: readonly IConnectorQueryFilterProvider[])
    {
        this.providers = providers;
    }

    public WhereFor(concept: string): QueryFilter | undefined
    {
        const all: QueryComparison[] = [];
        for (const provider of this.providers) all.push(...(provider.WhereFor(concept)?.All ?? []));
        return all.length === 0 ? undefined : { All: all };
    }
}
